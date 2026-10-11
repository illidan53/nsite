// 批量站长实测结果（/data/measured.json）：按点击位置找起点地区，给列表和“站长实测”一栏用。

import { cellOf } from './api.ts';
import { haversineKm } from './geo.ts';
import type { Place } from './places.ts';
import type { MeasuredCell, MeasuredData, MeasuredPair } from './types.ts';

export async function loadMeasured(): Promise<MeasuredData | null> {
  try {
    const res = await fetch('/data/measured.json');
    return res.ok ? ((await res.json()) as MeasuredData) : null;
  } catch {
    return null;
  }
}

export interface MeasuredOrigin {
  id: string;
  cell: MeasuredCell;
  /** 起点地区就是点击所在的省/州或国家；false 表示借用了同一国家里最近的已测地区。 */
  exact: boolean;
}

/** Natural Earth 把这些海外省算在法国名下（FR-xx），RIPE Atlas 探针用的是它们自己的国家代码。 */
const OVERSEAS: Record<string, string> = { 'FR-RE': 'RE', 'FR-GF': 'GF', 'FR-GP': 'GP', 'FR-MQ': 'MQ', 'FR-YT': 'YT' };

/**
 * 点击位置对应的批量实测起点：先找所在省/州，再找同一国家里最近的已测省/州，最后用整个国家。
 * 大国分省测过之后，早期按国家测的旧地区（只有一个探针）仍留在数据里，所以省/州优先于国家。
 */
export function measuredOriginFor(data: MeasuredData | null, place: Place | null, origin: { lat: number; lng: number } | null): MeasuredOrigin | null {
  const c = cellOf(place);
  if (!data || !c || !origin) return null;
  const own = data.cells[c.cell];
  if (c.cell !== c.country && own?.country === c.country) return { id: c.cell, cell: own, exact: true };
  const alias = OVERSEAS[c.cell];
  if (alias) return data.cells[alias] ? { id: alias, cell: data.cells[alias], exact: true } : null;
  let best: MeasuredOrigin | null = null;
  let bestKm = Infinity;
  for (const [id, cell] of Object.entries(data.cells)) {
    if (cell.country !== c.country || id === c.country) continue;
    const km = haversineKm(origin.lat, origin.lng, cell.lat, cell.lng);
    if (km < bestKm) {
      bestKm = km;
      best = { id, cell, exact: false };
    }
  }
  if (best) return best;
  return data.cells[c.country] ? { id: c.country, cell: data.cells[c.country], exact: true } : null;
}

/**
 * 光在光纤里约 200 km/ms，往返 RTT 不可能低于「距离 / 100」毫秒（留 200 km 给只精确到城市的坐标）。
 * 比这还快的「到达」是途中设备冒充目标代答了 TCP 握手（透明代理、防火墙），不是目标本身。
 */
export function fasterThanLight(rttMs: number, km: number): boolean {
  return rttMs < (km - 200) / 100;
}

/** 该地区到该区域各探针里最低的到达 RTT；都没到达时为 null。 */
export function bestRtt(pair: MeasuredPair | undefined): number | null {
  const rtts = (pair?.results ?? []).map((r) => r.rtt).filter((r): r is number => r !== null);
  return rtts.length ? Math.min(...rtts) : null;
}
