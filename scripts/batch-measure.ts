// 批量站长实测：用站长个人 RIPE Atlas 账号，从各国（大国细分到省/州）的公共探针向各云区域的公开地址做一次性 TCP/ICMP traceroute。
//
//   node scripts/batch-measure.ts plan  [选项]              只列计划和积分（不需要 key，不花积分）
//   node scripts/batch-measure.ts run   [选项] --yes        创建测量（需要环境变量 RIPE_ATLAS_KEY），计划写到 docs/measurements/<批次>.json
//   node scripts/batch-measure.ts run   --resume <批次> --max-credits <n> --yes  继续创建上次中断时还没建的测量
//   node scripts/batch-measure.ts collect                    读取所有批次的结果（公开 API），写 docs/measured.json
//
// 选项：--nearest <n|all>  每家厂商离起点最近的 n 个区域（默认 3）
//       --probes <k>       每个起点地区的探针数（默认 2）
//       --split <CC,...>   细分到省/州的国家（默认 DEFAULT_SPLIT 的 25 个；只能用 SPLIT_ADM0 里有的；传 none 表示不细分）
//       --pairs <file>     只测文件里列出的「起点地区-区域」组合：[{ "cell": "CN-BJ", "region": "aws:ap-southeast-1", "probes": 2 }]
//                          已经测过这个组合的探针不再选（用来给只有 1 个结果的组合补探针）
//       --cells <id,...>   只测这些起点地区（如 JP,IE 或 US-NJ），用于补测
//       --skip-measured    跳过 docs/measured.json 里已经测到过（至少一个探针到达）的「起点地区-区域」组合
//       --max-credits <n>  计划超过这个积分就不创建（run 和 run --resume 都必填）
//
// 被测云厂商自己网络里的探针（src/lib/providers.ts 里的 ASN）不参与：它们代表不了当地用户。
// 以前的结果里某种协议测过至少 2 次却从没到达的探针也不参与（多半是所在网络拦了 traceroute）。
//
// 需要先 npm run data（用 public/data 里的区域、公开地址和省界）。

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { geoBounds, geoContains } from 'd3-geo';
import type { Feature, Geometry } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { parseTraceroute } from '../src/lib/atlas.ts';
import { haversineKm } from '../src/lib/geo.ts';
import { fasterThanLight } from '../src/lib/measured.ts';
import { PROVIDERS } from '../src/lib/providers.ts';
import type { MeasuredData, NetworkData, TargetsData } from '../src/lib/types.ts';
import {
  CREDITS_PER_RESULT,
  failedProbes,
  median,
  pairKey,
  plan,
  planCost,
  planPairs,
  silentProbes,
  type PairRequest,
  type BatchCell,
  type BatchProbe,
  type BatchTarget,
  type PlanOptions,
  type PlannedMeasurement,
} from './batch-plan.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'public', 'data');
const RUNS = path.join(ROOT, 'docs', 'measurements');
const MEASURED = path.join(ROOT, 'docs', 'measured.json');
const ATLAS = 'https://atlas.ripe.net/api/v2';
/**
 * 细分到省/州的国家，以及它们在 Natural Earth 里的 ISO3（排掉挂在别国名下的省级单位，如 US-PR 属于 PRI、乌克兰的克里米亚记在 RUS 名下）。
 * 选的是面积大、各地延迟差别明显的国家。英法意西荷波等的一级行政区是郡 / 省（英国 149 个），彼此离得近、测出来几乎一样，不细分。
 */
const SPLIT_ADM0: Record<string, string> = {
  US: 'USA', CA: 'CAN', BR: 'BRA', RU: 'RUS', CN: 'CHN', IN: 'IND', AU: 'AUS',
  JP: 'JPN', ID: 'IDN', MX: 'MEX', AR: 'ARG', ZA: 'ZAF', KZ: 'KAZ', TR: 'TUR', UA: 'UKR', SE: 'SWE',
  PH: 'PHL', DE: 'DEU', TH: 'THA', VN: 'VNM', IR: 'IRN', SA: 'SAU', NG: 'NGA', PK: 'PAK', EG: 'EGY',
  // 只挑少数省单独测（配合 --cells）：其余地方仍用按全国测的数据，网页按距离给每个数据中心取最近的实测
  AF: 'AFG', AO: 'AGO', AT: 'AUT', AZ: 'AZE', BG: 'BGR', BJ: 'BEN', BO: 'BOL', CD: 'COD', CI: 'CIV', CL: 'CHL',
  CO: 'COL', ES: 'ESP', FI: 'FIN', FR: 'FRA', GB: 'GBR', GR: 'GRC', IQ: 'IRQ', IT: 'ITA', KE: 'KEN', KG: 'KGZ',
  KR: 'KOR', LA: 'LAO', LY: 'LBY', MA: 'MAR', MW: 'MWI', MY: 'MYS', MZ: 'MOZ', NO: 'NOR', NZ: 'NZL', PE: 'PER',
  PL: 'POL', PT: 'PRT', RO: 'ROU', SY: 'SYR', TZ: 'TZA', UG: 'UGA', UZ: 'UZB', VE: 'VEN', ZM: 'ZMB',
};
/** 默认整国分省的 25 个国家（其余 SPLIT_ADM0 里的国家只在 --split + --cells 时挑省测）。 */
const DEFAULT_SPLIT = ['US', 'CA', 'BR', 'RU', 'CN', 'IN', 'AU', 'JP', 'ID', 'MX', 'AR', 'ZA', 'KZ', 'TR', 'UA', 'SE', 'PH', 'DE', 'TH', 'VN', 'IR', 'SA', 'NG', 'PK', 'EG'];

type RunOptions = Omit<PlanOptions, 'skip'> & { split: string[]; skipped?: number };

interface RunFile {
  id: string;
  createdAt: string;
  options: RunOptions;
  cells: Record<string, { country: string; lat: number; lng: number }>;
  probes: Record<string, { lat: number; lng: number; asn: number; cc: string }>;
  measurements: { region: string; host: string; protocol: 'ICMP' | 'TCP'; probes: { id: number; cell: string }[]; msm: number | null }[];
}

// ---------------------------------------------------------------- 参数

const BOOLEAN_FLAGS = new Set(['yes', 'skip-measured']);
const VALUE_FLAGS = new Set(['nearest', 'probes', 'split', 'cells', 'max-credits', 'resume', 'pairs']);

/** --split 只能用 SPLIT_ADM0 里的国家：没有 ISO3 就排不掉挂在别国名下的省级单位。 */
function splitList(v: string) {
  const list = v.split(',').map((s) => s.trim().toUpperCase());
  const unknown = list.filter((cc) => !SPLIT_ADM0[cc]);
  if (unknown.length) throw new Error(`--split 不认识 ${unknown.join(',')}：先在 SPLIT_ADM0 里加上它们的 ISO3`);
  return list;
}

/** 选项写错（少了值、拼错、不是整数）时直接报错：宁可不跑，也不要按默认值花积分。 */
function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const name = a.slice(2);
    if (!a.startsWith('--')) rest.push(a);
    else if (BOOLEAN_FLAGS.has(name)) flags.set(name, '1');
    else if (VALUE_FLAGS.has(name)) {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} 需要一个值`);
      flags.set(name, v);
    } else throw new Error(`未知选项 ${a}`);
  }
  const int = (name: string, fallback: number | null) => {
    const v = flags.get(name);
    if (v === undefined) return fallback;
    if (!/^\d+$/.test(v)) throw new Error(`--${name} 需要整数，收到 ${v}`);
    return Number(v);
  };
  const nearest = flags.get('nearest');
  const split = flags.get('split');
  const only = flags.get('cells');
  return {
    command: rest[0] ?? 'plan',
    opts: {
      nearest: nearest === 'all' ? ('all' as const) : Math.max(1, int('nearest', 3)!),
      probes: Math.max(1, int('probes', 2)!),
      split: split === undefined ? DEFAULT_SPLIT : split === 'none' ? [] : splitList(split),
      excludeAsns: PROVIDERS.flatMap((p) => p.asns),
    },
    cells: only ? only.split(',').map((s) => s.trim().toUpperCase()) : null,
    maxCredits: int('max-credits', null),
    resume: flags.get('resume') ?? null,
    pairs: flags.get('pairs') ?? null,
    skipMeasured: flags.has('skip-measured'),
    yes: flags.has('yes'),
  };
}

// ---------------------------------------------------------------- 数据

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

async function loadTargets(): Promise<BatchTarget[]> {
  const [network, targets, source] = await Promise.all([
    readJson<NetworkData>(path.join(DATA, 'network.json')),
    readJson<TargetsData>(path.join(DATA, 'targets.json')),
    readJson<TargetsData>(path.join(ROOT, 'docs', 'atlas-targets.json')),
  ]);
  // 协议以入库的 docs/atlas-targets.json 为准：public/data 是 npm run data 生成的副本，改了协议没重新生成时会过时
  const method = new Map(source.targets.map((t) => [t.region, t.method]));
  const regions = new Map(network.regions.map((r) => [r.id, r]));
  return targets.targets
    .filter((t) => regions.has(t.region))
    .map((t) => ({
      region: t.region,
      provider: t.provider,
      host: t.host,
      protocol: (method.get(t.region) ?? t.method) === 'icmp' ? 'ICMP' : 'TCP',
      lat: regions.get(t.region)!.lat,
      lng: regions.get(t.region)!.lng,
    }));
}

async function fetchProbes(): Promise<BatchProbe[]> {
  const out: BatchProbe[] = [];
  let url: string | null = `${ATLAS}/probes/?status=1&page_size=500&fields=id,country_code,asn_v4,geometry,tags`;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`RIPE Atlas probes ${res.status}`);
    const d = (await res.json()) as {
      next: string | null;
      results: { id: number; country_code: string; asn_v4: number | null; geometry: { coordinates: [number, number] } | null; tags: { slug: string }[] }[];
    };
    for (const p of d.results) {
      if (!p.asn_v4 || !p.geometry || !/^[A-Z]{2}$/.test(p.country_code ?? '')) continue;
      out.push({
        id: p.id,
        lat: p.geometry.coordinates[1],
        lng: p.geometry.coordinates[0],
        asn: p.asn_v4,
        cc: p.country_code,
        stable: p.tags.some((t) => t.slug === 'system-ipv4-stable-1d'),
      });
    }
    url = d.next;
  }
  return out;
}

/** 已有结果：要排除的失败 / 不回结果的探针，已经测到过的「起点地区|区域」组合，以及每个组合用过的探针。 */
async function loadPrevious(
  targets: BatchTarget[],
): Promise<{ failed: ReturnType<typeof failedProbes>; silent: number[]; measured: Set<string>; used: Map<string, number[]>; stale: string[] }> {
  const data = await readJson<MeasuredData>(MEASURED).catch(() => null);
  if (!data) return { failed: { ICMP: [], TCP: [] }, silent: [], measured: new Set(), used: new Map(), stale: [] };
  // 还没 collect 的批次、或中断后还没建完的批次：跳过已测时会把它们的组合再买一遍
  const collected = new Set(data.runs.map((r) => r.id));
  const stale: string[] = [];
  const scheduled: number[] = [];
  /** 每次测量当时用的协议（目标改过协议时，旧结果仍按旧协议算）。 */
  const protocolOf = new Map<number, BatchTarget['protocol']>();
  for (const f of (await readdir(RUNS).catch(() => [])).filter((f) => f.endsWith('.json'))) {
    const run = await readJson<RunFile>(path.join(RUNS, f));
    const done = collected.has(run.id);
    if (!done || run.measurements.some((m) => m.msm === null)) stale.push(run.id);
    // 每个探针每个已收集的批次只算一次：silentProbes 的“至少 2 次”就是至少 2 个批次都没回结果
    const inRun = new Set<number>();
    for (const m of run.measurements) {
      if (m.msm === null) continue;
      protocolOf.set(m.msm, m.protocol);
      if (done) for (const p of m.probes) inRun.add(p.id);
    }
    scheduled.push(...inRun);
  }
  const current = new Map(targets.map((t) => [t.region, t.protocol]));
  const results: Parameters<typeof failedProbes>[0] = [];
  const measured = new Set<string>();
  const used = new Map<string, number[]>();
  const returned = new Set<number>();
  for (const [cellId, cell] of Object.entries(data.cells)) {
    for (const [region, pair] of Object.entries(cell.regions)) {
      for (const r of pair.results) {
        const p = protocolOf.get(r.msm ?? pair.msm) ?? current.get(region);
        if (p) results.push({ probe: r.probe, protocol: p, rtt: r.rtt });
        returned.add(r.probe);
      }
      if (pair.results.some((r) => r.rtt !== null)) measured.add(pairKey(cellId, region));
      // 只算用现在这种协议测过的探针：目标改了协议（如大阪改 TCP）后，原来的探针可以再测
      const now = current.get(region);
      used.set(pairKey(cellId, region), pair.results.filter((r) => (protocolOf.get(r.msm ?? pair.msm) ?? now) === now).map((r) => r.probe));
    }
  }
  return { failed: failedProbes(results), silent: silentProbes(scheduled, returned), measured, used, stale };
}

type Admin1 = Feature<Geometry, { iso: string; adm0: string; labelLat: number; labelLng: number; area: number | null }>;

/** 探针落在省界外时，离最近的省界顶点超过这个距离就不用（多半是坐标或国家代码不准）。 */
const MAX_OFF_BORDER_KM = 100;

const vertices = (g: Geometry): number[][] => (g.type === 'Polygon' ? g.coordinates.flat() : g.type === 'MultiPolygon' ? g.coordinates.flat(2) : []);

/**
 * RIPE Atlas 按所属国记的探针，实际在这些地方的国界内：改归到网页用的代码（src/lib/api.ts 的 cellOf / NO_ISO2），
 * 否则科索沃的探针算塞尔维亚，那里永远没有实测数据。
 */
const BY_BORDER: { iso3: string; from: string; cell: string }[] = [
  { iso3: 'KOS', from: 'RS', cell: 'XK' },
  // 北塞浦路斯（XN）暂不按国界归：简化后的国界把尼科西亚南边（塞浦路斯共和国运营商）的探针也圈了进去
];

/** 起点地区：大国按省/州（探针落在哪个省界里），其余按国家。 */
async function buildCells(probes: BatchProbe[], split: string[]): Promise<BatchCell[]> {
  const topo = await readJson<Topology>(path.join(DATA, 'admin1.topo.json'));
  const countriesTopo = await readJson<Topology>(path.join(DATA, 'countries.topo.json'));
  const countryShapes = (feature(countriesTopo, countriesTopo.objects.countries) as unknown as { features: Feature<Geometry, { iso3: string }>[] }).features;
  const borders = BY_BORDER.map((b) => ({ ...b, shape: countryShapes.find((f) => f.properties.iso3 === b.iso3) })).filter((b) => b.shape);
  // 只要正式的省级代码（Natural Earth 里 AU-X02~ 这类带 ~ 的前端也认不出）
  const admin1 = (feature(topo, topo.objects.admin1) as unknown as { features: Admin1[] }).features.filter((f) => {
    const cc = f.properties.iso?.slice(0, 2);
    return split.includes(cc) && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(f.properties.iso.toUpperCase()) && f.properties.adm0 === SPLIT_ADM0[cc];
  });
  const boxes = admin1.map((f) => geoBounds(f));
  const inBox = (i: number, lat: number, lng: number) => {
    const [[w, s], [e, n]] = boxes[i];
    return lat >= s && lat <= n && (w <= e ? lng >= w && lng <= e : lng >= w || lng <= e);
  };

  const groups = new Map<string, BatchProbe[]>();
  const countryOf = new Map<string, string>();
  for (const p of probes) {
    const moved = borders.find((b) => p.cc === b.from && geoContains(b.shape!, [p.lng, p.lat]));
    if (moved) {
      const list = groups.get(moved.cell) ?? [];
      list.push(p);
      groups.set(moved.cell, list);
      countryOf.set(moved.cell, moved.cell);
      continue;
    }
    let key = p.cc;
    const same = split.includes(p.cc) ? admin1.map((f, i) => ({ f, i })).filter(({ f }) => f.properties.iso.startsWith(`${p.cc}-`)) : [];
    if (same.length) {
      let iso = same.find(({ f, i }) => inBox(i, p.lat, p.lng) && geoContains(f, [p.lng, p.lat]))?.f.properties.iso;
      if (!iso) {
        // 落在省界外（坐标不精确、简化后的省界漏掉了河中岛和海岸）：归到省界顶点离它最近的省。
        // 太远就不用这个探针，也不归到整个国家：那样会生成新的国家级地区，覆盖以前按国家测的数据。
        let best = MAX_OFF_BORDER_KM;
        for (const { f } of same) {
          for (const [lng, lat] of vertices(f.geometry)) {
            const km = haversineKm(p.lat, p.lng, lat, lng);
            if (km < best) [best, iso] = [km, f.properties.iso];
          }
        }
        if (!iso) continue;
      }
      key = iso.toUpperCase();
    }
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }

  // 同一代码有多块时（如 AU-NSW 还有豪勋爵岛）用面积最大的那块的标注点
  const label = new Map<string, Admin1['properties']>();
  for (const f of admin1) {
    const k = f.properties.iso.toUpperCase();
    const prev = label.get(k);
    if (!prev || (f.properties.area ?? 0) > (prev.area ?? 0)) label.set(k, f.properties);
  }
  return [...groups.entries()]
    .map(([id, list]) => {
      const l = label.get(id);
      return {
        id,
        country: countryOf.get(id) ?? list[0].cc,
        lat: l ? l.labelLat : median(list.map((p) => p.lat)),
        lng: l ? l.labelLng : median(list.map((p) => p.lng)),
        probes: list,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- plan

const fmt = (n: number) => n.toLocaleString('en-US');

function printTiers(cellsBySplit: Map<string, BatchCell[]>, targets: BatchTarget[], base: Pick<PlanOptions, 'excludeAsns' | 'excludeProbes' | 'skip'>) {
  const tiers: { label: string; nearest: number | 'all'; probes: number; split: boolean }[] = [
    { label: '每家最近 1 个 · 1 探针 · 只按国家', nearest: 1, probes: 1, split: false },
    { label: '每家最近 2 个 · 2 探针 · 大国分省', nearest: 2, probes: 2, split: true },
    { label: '每家最近 3 个 · 2 探针 · 大国分省', nearest: 3, probes: 2, split: true },
    { label: '每家最近 3 个 · 3 探针 · 大国分省', nearest: 3, probes: 3, split: true },
    { label: '全部区域 · 1 探针 · 只按国家', nearest: 'all', probes: 1, split: false },
    { label: '全部区域 · 2 探针 · 大国分省', nearest: 'all', probes: 2, split: true },
  ];
  console.log(`\n参考档位（一次性 traceroute，每个结果 ${CREDITS_PER_RESULT} 积分${base.skip ? '，已跳过测到过的组合' : ''}）：`);
  for (const t of tiers) {
    const cells = cellsBySplit.get(t.split ? 'split' : 'none')!;
    const c = planCost(plan(cells, targets, { ...base, nearest: t.nearest, probes: t.probes }));
    console.log(`  ${t.label.padEnd(24, '　')}  地区 ${String(cells.length).padStart(4)}  测量 ${String(c.measurements).padStart(4)}  结果 ${fmt(c.results).padStart(7)}  积分 ${fmt(c.credits).padStart(10)}`);
  }
}

function runId() {
  return new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
}

function toRunFile(id: string, opts: PlanOptions & { split: string[] }, cells: BatchCell[], planned: PlannedMeasurement[]): RunFile {
  const { skip, ...options } = opts;
  const used = new Set(planned.flatMap((m) => m.probes.map((p) => p.cell)));
  const probes: RunFile['probes'] = {};
  for (const m of planned) for (const { probe } of m.probes) probes[probe.id] = { lat: probe.lat, lng: probe.lng, asn: probe.asn, cc: probe.cc };
  return {
    id,
    createdAt: new Date().toISOString(),
    options: { ...options, ...(skip ? { skipped: skip.size } : {}) },
    cells: Object.fromEntries(cells.filter((c) => used.has(c.id)).map((c) => [c.id, { country: c.country, lat: c.lat, lng: c.lng }])),
    probes,
    measurements: planned.map((m) => ({
      region: m.target.region,
      host: m.target.host,
      protocol: m.target.protocol,
      probes: m.probes.map((p) => ({ id: p.probe.id, cell: p.cell })),
      msm: null,
    })),
  };
}

// ---------------------------------------------------------------- run

async function atlasPost(key: string, body: unknown): Promise<{ measurements: number[] }> {
  const res = await fetch(`${ATLAS}/measurements/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Key ${key}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.ok) return JSON.parse(text) as { measurements: number[] };
  let detail = text.slice(0, 400);
  try {
    const e = (JSON.parse(text) as { error?: { detail?: string; errors?: { detail?: string }[] } }).error;
    detail = [e?.detail, ...(e?.errors ?? []).map((x) => x.detail)].filter(Boolean).join(' — ') || detail;
  } catch {
    // 保留原文
  }
  const err = new Error(`RIPE Atlas ${res.status}: ${detail}`) as Error & { status: number };
  err.status = res.status;
  throw err;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function createAll(run: RunFile, file: string, key: string) {
  const todo = run.measurements.filter((m) => m.msm === null);
  console.log(`待创建 ${todo.length} 个测量`);
  for (const [i, m] of todo.entries()) {
    const body = {
      definitions: [
        {
          type: 'traceroute',
          af: 4,
          target: m.host,
          protocol: m.protocol,
          ...(m.protocol === 'TCP' ? { port: 443 } : {}),
          description: `nsite batch ${run.id} ${m.region}`.replace(/[^A-Za-z0-9 ._-]/g, ' '),
        },
      ],
      probes: [{ type: 'probes', value: m.probes.map((p) => p.id).join(','), requested: m.probes.length }],
      is_oneoff: true,
    };
    for (let attempt = 0; ; attempt++) {
      try {
        m.msm = (await atlasPost(key, body)).measurements[0];
        break;
      } catch (err) {
        const e = err as Error & { status?: number };
        // 同时进行的测量数、速率等限制：等一会儿再试；其它错误（如积分不足）直接停下
        const transient = e.status === 429 || e.status === 503 || /simultaneous|concurrent|too many|rate.?limit/i.test(e.message);
        if (!transient || attempt >= 30) {
          await writeFile(file, JSON.stringify(run, null, 1) + '\n');
          throw e;
        }
        console.log(`  ${m.region}: ${e.message}，60 秒后重试`);
        await sleep(60_000);
      }
    }
    await writeFile(file, JSON.stringify(run, null, 1) + '\n');
    console.log(`  [${i + 1}/${todo.length}] ${m.region} → #${m.msm}（${m.probes.length} 个探针）`);
    await sleep(1500);
  }
}

// ---------------------------------------------------------------- collect

async function collect() {
  const files = (await readdir(RUNS).catch(() => [])).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) throw new Error('docs/measurements/ 里没有批次文件');
  const out: MeasuredData = { generatedAt: new Date().toISOString(), runs: [], probes: {}, cells: {} };
  // 早期批次里有少数探针就在被测云厂商的网络里，结果代表不了当地用户，一律不收
  const cloud = new Set(PROVIDERS.flatMap((p) => p.asns));
  const regions = new Map((await readJson<NetworkData>(path.join(DATA, 'network.json'))).regions.map((r) => [r.id, r]));
  let pending = 0;
  let skipped = 0;
  let spoofed = 0;
  for (const f of files) {
    const run = await readJson<RunFile>(path.join(RUNS, f));
    const runIdx = out.runs.length;
    let results = 0;
    Object.assign(out.probes, run.probes);
    for (const m of run.measurements) {
      if (m.msm === null) continue;
      const res = await fetch(`${ATLAS}/measurements/${m.msm}/results/?format=json`);
      if (!res.ok) throw new Error(`#${m.msm} results ${res.status}`);
      const traces = ((await res.json()) as Parameters<typeof parseTraceroute>[0][]).map(parseTraceroute);
      const byProbe = new Map(traces.map((t) => [t.probeId, t]));
      pending += m.probes.filter((p) => !byProbe.has(p.id)).length;
      results += traces.length;
      for (const p of m.probes) {
        const t = byProbe.get(p.id);
        if (!t) continue;
        if (cloud.has(run.probes[p.id]?.asn)) {
          skipped++;
          continue;
        }
        const cellInfo = run.cells[p.cell];
        const cell = (out.cells[p.cell] ??= { country: cellInfo.country, lat: cellInfo.lat, lng: cellInfo.lng, regions: {} });
        let pair = cell.regions[m.region];
        if (!pair) pair = cell.regions[m.region] = { run: runIdx, msm: m.msm, target: m.host, at: 0, results: [] };
        else if (pair.run !== runIdx) {
          // 后来的批次补测同一组合：重测过的探针以新结果为准，旧结果里这次没重测的保留（记下原来的测量号）
          const old = pair;
          pair = cell.regions[m.region] = { run: runIdx, msm: m.msm, target: m.host, at: old.at, results: old.results.map((r) => ({ ...r, msm: r.msm ?? old.msm })) };
        }
        const dest = t.hops.filter((h) => h.ip === t.dstAddr && h.minRtt !== null).at(-1);
        let rtt = t.reached && dest ? Math.round(dest.minRtt! * 10) / 10 : null;
        const probe = run.probes[p.id];
        const region = regions.get(m.region);
        // 比光速还快的「到达」是途中设备代答，不算到达
        if (rtt !== null && probe && region && fasterThanLight(rtt, haversineKm(probe.lat, probe.lng, region.lat, region.lng))) {
          rtt = null;
          spoofed++;
        }
        pair.results = pair.results.filter((r) => r.probe !== p.id);
        pair.results.push(m.msm === pair.msm ? { probe: p.id, rtt } : { probe: p.id, rtt, msm: m.msm });
        pair.at = Math.max(pair.at, t.timestamp);
      }
      process.stdout.write('.');
    }
    out.runs.push({ id: run.id, createdAt: run.createdAt, measurements: run.measurements.length, results, credits: results * CREDITS_PER_RESULT });
  }
  // 这种协议一律到不了的探针（和规划时排除的规则一样）：它们的空结果标成 bad，网页不拿来说“数据中心不通”
  const protocolOf = new Map<number, BatchTarget['protocol']>();
  for (const f of files) for (const m of (await readJson<RunFile>(path.join(RUNS, f))).measurements) if (m.msm !== null) protocolOf.set(m.msm, m.protocol);
  const all = Object.values(out.cells).flatMap((c) => Object.values(c.regions).flatMap((p) => p.results.map((r) => ({ r, protocol: protocolOf.get(r.msm ?? p.msm) }))));
  const bad = failedProbes(all.filter((x) => x.protocol).map(({ r, protocol }) => ({ probe: r.probe, protocol: protocol!, rtt: r.rtt })));
  const badSet = { ICMP: new Set(bad.ICMP), TCP: new Set(bad.TCP) };
  for (const { r, protocol } of all) if (protocol && r.rtt === null && badSet[protocol].has(r.probe)) r.bad = true;
  await writeFile(MEASURED, JSON.stringify(out) + '\n');
  const pairs = Object.values(out.cells).flatMap((c) => Object.values(c.regions));
  const rs = pairs.flatMap((p) => p.results);
  console.log(`\n写入 docs/measured.json：${Object.keys(out.cells).length} 个地区、${pairs.length} 个地区-区域组合、${rs.length} 个结果，到达目标 ${rs.filter((r) => r.rtt !== null).length} 个`);
  if (skipped) console.log(`跳过 ${skipped} 个来自被测云厂商网络内探针的结果`);
  if (spoofed) console.log(`${spoofed} 个结果比光速还快（途中设备代答），按未到达处理`);
  if (pending) console.log(`还有 ${pending} 个探针没有返回结果（测量可能还在进行，稍后再 collect 一次）`);
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'collect') return collect();

  if (args.command === 'run' && args.resume) {
    const key = process.env.RIPE_ATLAS_KEY;
    if (!key) throw new Error('需要环境变量 RIPE_ATLAS_KEY');
    const file = path.join(RUNS, `${args.resume}.json`);
    const run = await readJson<RunFile>(file);
    const left = run.measurements.filter((m) => m.msm === null).reduce((s, m) => s + m.probes.length, 0) * CREDITS_PER_RESULT;
    if (args.maxCredits === null) throw new Error('run --resume 也需要 --max-credits');
    if (left > args.maxCredits) throw new Error(`剩下的测量约需 ${fmt(left)} 积分，超过 --max-credits ${fmt(args.maxCredits)}`);
    if (!args.yes) throw new Error('确认要花积分时加 --yes');
    return createAll(run, file, key);
  }

  console.log('读取区域和公开地址、拉取在线探针…');
  const [targets, probes] = await Promise.all([loadTargets(), fetchProbes()]);
  const previous = await loadPrevious(targets);
  if ((args.skipMeasured || args.pairs) && previous.stale.length) throw new Error(`批次 ${previous.stale.join(',')} 还没 collect，先运行 collect`);
  // 一直不回结果的探针两种协议都不用
  const excludeProbes = { ICMP: [...previous.failed.ICMP, ...previous.silent], TCP: [...previous.failed.TCP, ...previous.silent] };
  const opts: PlanOptions & { split: string[] } = {
    ...args.opts,
    excludeProbes,
    ...(args.skipMeasured ? { skip: previous.measured } : {}),
  };
  for (const [protocol, ids] of Object.entries(previous.failed)) {
    if (ids.length) console.log(`以前 ${protocol} 一直到不了目标、这次 ${protocol} 不用的探针：${ids.join(', ')}`);
  }
  if (previous.silent.length) console.log(`安排过却从没回过结果、这次不用的探针 ${previous.silent.length} 个`);
  if (opts.skip) console.log(`跳过已经测到过的组合 ${fmt(opts.skip.size)} 个`);
  const allCells = await buildCells(probes, opts.split);
  // 按组合测时，全国的地区（如 FR）和各省（如 FR-06）都可能出现在清单里：两种分法的地区合在一起找（代码不会重名）
  const pool = args.pairs
    ? [...new Map([...(await buildCells(probes, [])), ...(await buildCells(probes, Object.keys(SPLIT_ADM0)))].map((c) => [c.id, c] as const)).values()]
    : allCells;
  const cells = args.cells ? pool.filter((c) => args.cells!.includes(c.id)) : pool;
  if (args.cells && cells.length !== args.cells.length) throw new Error(`找不到起点地区：${args.cells.filter((id) => !cells.some((c) => c.id === id)).join(',')}`);
  let planned: PlannedMeasurement[];
  if (args.pairs) {
    if (args.skipMeasured) throw new Error('--pairs 不能和 --skip-measured 一起用：补测本来就是给测过的组合加探针');
    const requests = await readJson<PairRequest[]>(path.resolve(args.pairs));
    if (!Array.isArray(requests)) throw new Error(`${args.pairs} 应该是数组`);
    const seen = new Set<string>();
    for (const r of requests) {
      if (typeof r?.cell !== 'string' || typeof r?.region !== 'string' || !Number.isInteger(r.probes) || r.probes < 1 || r.probes > 10) {
        throw new Error(`--pairs 里的组合写错了：${JSON.stringify(r)}（需要 cell、region 和 1–10 的整数 probes）`);
      }
      const k = pairKey(r.cell, r.region);
      if (seen.has(k)) throw new Error(`--pairs 里有重复的组合 ${k}，先合并`);
      seen.add(k);
    }
    const r = planPairs(cells, targets, requests, { excludeAsns: opts.excludeAsns, excludeProbes, used: previous.used });
    planned = r.planned;
    const why = new Map<string, number>();
    for (const x of r.skipped) why.set(x.why, (why.get(x.why) ?? 0) + 1);
    console.log(`按 ${path.basename(args.pairs)} 测 ${fmt(requests.length)} 个组合，跳过 ${r.skipped.length} 个（${[...why].map(([k, n]) => `${k} ${n}`).join('，') || '无'}）`);
  } else planned = plan(cells, targets, opts);
  const cost = planCost(planned);
  console.log(`在线探针 ${fmt(probes.length)} 个，公开地址 ${targets.length} 个区域`);
  console.log(
    `本次选项：每家最近 ${opts.nearest} 个区域 · 每地区 ${opts.probes} 个探针 · 分省 ${opts.split.join(',') || '无'}`,
  );
  console.log(`起点地区 ${cells.length} 个 → 测量 ${cost.measurements} 个，结果 ${fmt(cost.results)} 个，约 ${fmt(cost.credits)} 积分`);

  if (args.command === 'plan') {
    const other = opts.split.length ? await buildCells(probes, []) : await buildCells(probes, DEFAULT_SPLIT);
    printTiers(new Map([[opts.split.length ? 'split' : 'none', allCells], [opts.split.length ? 'none' : 'split', other]]), targets, opts);
    console.log('\nRIPE Atlas 每个账号每天最多花 1,000,000 积分、产生 100,000 个结果，同时最多 100 个测量。');
    return;
  }
  if (args.command !== 'run') throw new Error(`未知命令 ${args.command}`);

  const key = process.env.RIPE_ATLAS_KEY;
  if (!key) throw new Error('需要环境变量 RIPE_ATLAS_KEY');
  if (args.maxCredits === null) throw new Error('run 需要 --max-credits，防止一不小心花太多积分');
  if (cost.credits > args.maxCredits) throw new Error(`计划需要约 ${fmt(cost.credits)} 积分，超过 --max-credits ${fmt(args.maxCredits)}`);
  if (cost.results > 100_000 || cost.credits > 1_000_000) throw new Error('超过 RIPE Atlas 每日限额，请缩小范围分几天跑');
  if (!args.yes) throw new Error('确认要花积分时加 --yes');

  await mkdir(RUNS, { recursive: true });
  const id = runId();
  const file = path.join(RUNS, `${id}.json`);
  const run = toRunFile(id, opts, cells, planned);
  // wx：同名批次文件已存在时报错，不覆盖已经花了积分的批次
  await writeFile(file, JSON.stringify(run, null, 1) + '\n', { flag: 'wx' });
  console.log(`批次 ${id}，计划已写入 ${path.relative(ROOT, file)}`);
  await createAll(run, file, key);
  console.log('全部创建完成。一次性测量通常 5–15 分钟内出结果，之后运行：node scripts/batch-measure.ts collect');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
