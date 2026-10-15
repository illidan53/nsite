// 批量站长实测结果（/data/measured.json）：按点击位置找起点地区，给列表和“站长实测”一栏用。

import { cellOf } from './api.ts';
import { haversineKm } from './geo.ts';
import type { Place } from './places.ts';
import type { MeasuredCell, MeasuredData, MeasuredPair, Region } from './types.ts';

export async function loadMeasured(): Promise<MeasuredData | null> {
  try {
    const res = await fetch('/data/measured.json');
    return res.ok ? ((await res.json()) as MeasuredData) : null;
  } catch {
    return null;
  }
}

/** own：点击所在省（或该地区自己）的数据；near：借用同国另一个省；country：借用按全国测的数据。 */
export type OriginKind = 'own' | 'near' | 'country';

export interface MeasuredOrigin {
  id: string;
  cell: MeasuredCell;
  kind: OriginKind;
  /** 点击处到该地区最近一个探针的距离（km）。省的中心是地图标注点、全国的是探针的中位数，都可能离探针很远，所以按探针算。 */
  km: number;
  /** 点击处到该地区每个探针的距离（km）。 */
  probeKm: Record<number, number>;
  /** 借来的地区太远（超过 BORROW_MAX_KM），数值不采用，只用来提示“最近的实测地区在哪”。 */
  tooFar: boolean;
}

/** 借用别处的实测数据最多到这么远；再远就只用估算（新疆借四川、巴布亚借加里曼丹这类会误导）。 */
export const BORROW_MAX_KM = 500;

/** Natural Earth 把这些海外省算在法国名下（FR-xx），RIPE Atlas 探针用的是它们自己的国家代码。 */
const OVERSEAS: Record<string, string> = { 'FR-RE': 'RE', 'FR-GF': 'GF', 'FR-GP': 'GP', 'FR-MQ': 'MQ', 'FR-YT': 'YT' };

export interface MeasuredOrigins {
  /** 可用的实测地区：所在省/州自己的排第一，其余按距离（BORROW_MAX_KM 以内）。 */
  usable: MeasuredOrigin[];
  /** 图例里的“实测起点”：最近的可用地区；都太远时是最近的那个（标 tooFar）。 */
  nearest: MeasuredOrigin | null;
}

/**
 * 点击位置能用的批量实测地区：所在省/州自己的（own），同一国家其他省（near），按全国测的（country）。
 * 每个数据中心各自取最近、测过它的那个地区（见 mineFor），所以按全国测的旧数据（多半只测了最近的 1 个区域）
 * 和邻省（测了最近的 3 个）可以互相补上。
 */
export function measuredOriginsFor(data: MeasuredData | null, place: Place | null, origin: { lat: number; lng: number } | null): MeasuredOrigins {
  const none: MeasuredOrigins = { usable: [], nearest: null };
  const c = cellOf(place);
  if (!data || !c || !origin) return none;
  const make = (id: string, kind: OriginKind): MeasuredOrigin => {
    const cell = data.cells[id];
    const probeKm: Record<number, number> = {};
    for (const pair of Object.values(cell.regions)) {
      for (const r of pair.results) {
        const p = data.probes[r.probe];
        if (p && probeKm[r.probe] === undefined) probeKm[r.probe] = haversineKm(origin.lat, origin.lng, p.lat, p.lng);
      }
    }
    const kms = Object.values(probeKm);
    const km = kms.length ? Math.min(...kms) : haversineKm(origin.lat, origin.lng, cell.lat, cell.lng);
    return { id, cell, kind, km, probeKm, tooFar: kind !== 'own' && km > BORROW_MAX_KM };
  };
  const all: MeasuredOrigin[] = [];
  const own = data.cells[c.cell];
  const alias = OVERSEAS[c.cell];
  if (c.cell !== c.country && own?.country === c.country) all.push(make(c.cell, 'own'));
  else if (alias) {
    // 海外省只用它自己的数据，不借巴黎
    const o = data.cells[alias] ? make(alias, 'own') : null;
    return o ? { usable: [o], nearest: o } : none;
  }
  for (const [id, cell] of Object.entries(data.cells)) {
    if (cell.country !== c.country || all.some((o) => o.id === id)) continue;
    all.push(make(id, id === c.country ? 'country' : 'near'));
  }
  all.sort((a, b) => Number(b.kind === 'own') - Number(a.kind === 'own') || a.km - b.km);
  const usable = all.filter((o) => !o.tooFar);
  return { usable, nearest: usable[0] ?? all[0] ?? null };
}

/** 图例用的单个实测起点（见 measuredOriginsFor）。 */
export function measuredOriginFor(data: MeasuredData | null, place: Place | null, origin: { lat: number; lng: number } | null): MeasuredOrigin | null {
  return measuredOriginsFor(data, place, origin).nearest;
}

/**
 * 该地区到该区域测过、所有探针都没到达，而且至少 minProbes 个没到达的探针不是“这种协议一律到不了”的坏探针
 * （collect 标成 bad）。坏探针的空结果说明的是探针或它的运营商，不是数据中心。
 */
export function unreached(pair: MeasuredPair | undefined, minProbes = 1): boolean {
  if (!pair?.results.length || pair.results.some((r) => r.rtt !== null)) return false;
  return pair.results.filter((r) => !r.bad).length >= minProbes;
}

/**
 * 光在光纤里约 200 km/ms，往返 RTT 不可能低于「距离 / 100」毫秒（默认留 200 km 给探针和数据中心都只精确到城市的坐标）。
 * 比这还快的「到达」是途中设备冒充目标代答了 TCP 握手（透明代理、防火墙），不是目标本身。
 */
export function fasterThanLight(rttMs: number, km: number, slackKm = 200): boolean {
  return rttMs < (km - slackKm) / 100;
}

/** 该地区到该区域各探针里最低的到达 RTT；都没到达时为 null。 */
export function bestRtt(pair: MeasuredPair | undefined): number | null {
  const rtts = (pair?.results ?? []).map((r) => r.rtt).filter((r): r is number => r !== null);
  return rtts.length ? Math.min(...rtts) : null;
}

/**
 * 点击处看到的某个数据中心的站长实测：按 usable 的顺序（自己省优先、再按距离）取第一个有可用值的地区。
 * 可用值：到达了、不比从点击处到该区域的光速极限还快（点击处坐标是准的，只给数据中心留 50 km 余量），
 * 借来的地区还要求这个探针离点击处不超过 BORROW_MAX_KM。
 * 都没有可用值、但测过且确实不通（自己省 1 个好探针，借来的要 2 个）时算“不通”。origin 是这个值来自哪个地区。
 */
export function mineFor(
  usable: MeasuredOrigin[],
  region: Region,
  from: { lat: number; lng: number },
): { ms: number | null; unreached: boolean; origin: MeasuredOrigin | null } {
  const floorKm = haversineKm(from.lat, from.lng, region.lat, region.lng);
  let dead: MeasuredOrigin | null = null;
  for (const o of usable) {
    const pair = o.cell.regions[region.id];
    if (!pair) continue;
    const near = (probe: number) => o.kind === 'own' || (o.probeKm[probe] ?? o.km) <= BORROW_MAX_KM;
    const ok = pair.results
      .filter((r) => r.rtt !== null && near(r.probe) && !fasterThanLight(r.rtt, floorKm, 50))
      .map((r) => r.rtt as number);
    if (ok.length) return { ms: Math.min(...ok), unreached: false, origin: o };
    if (unreached(pair, o.kind === 'own' ? 1 : 2)) dead ??= o;
  }
  return { ms: null, unreached: dead !== null, origin: dead };
}
