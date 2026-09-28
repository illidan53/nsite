// 批量站长实测：用站长个人 RIPE Atlas 账号，从各国（大国细分到省/州）的公共探针向各云区域的公开地址做一次性 TCP/ICMP traceroute。
//
//   node scripts/batch-measure.ts plan  [选项]              只列计划和积分（不需要 key，不花积分）
//   node scripts/batch-measure.ts run   [选项] --yes        创建测量（需要环境变量 RIPE_ATLAS_KEY），计划写到 docs/measurements/<批次>.json
//   node scripts/batch-measure.ts run   --resume <批次> --yes  继续创建上次中断时还没建的测量
//   node scripts/batch-measure.ts collect                    读取所有批次的结果（公开 API），写 docs/measured.json
//
// 选项：--nearest <n|all>  每家厂商离起点最近的 n 个区域（默认 3）
//       --probes <k>       每个起点地区的探针数（默认 2）
//       --split <CC,...>   细分到省/州的国家（默认 US,CA,BR,RU,CN,IN,AU；传 none 表示不细分）
//       --cells <id,...>   只测这些起点地区（如 JP,IE 或 US-NJ），用于补测
//       --max-credits <n>  计划超过这个积分就不创建（run 必填）
//
// 被测云厂商自己网络里的探针（src/lib/providers.ts 里的 ASN）不参与：它们代表不了当地用户。
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
import { PROVIDERS } from '../src/lib/providers.ts';
import type { MeasuredData, NetworkData, TargetsData } from '../src/lib/types.ts';
import {
  CREDITS_PER_RESULT,
  median,
  plan,
  planCost,
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
const DEFAULT_SPLIT = ['US', 'CA', 'BR', 'RU', 'CN', 'IN', 'AU'];

interface RunFile {
  id: string;
  createdAt: string;
  options: PlanOptions & { split: string[] };
  cells: Record<string, { country: string; lat: number; lng: number }>;
  probes: Record<string, { lat: number; lng: number; asn: number; cc: string }>;
  measurements: { region: string; host: string; protocol: 'ICMP' | 'TCP'; probes: { id: number; cell: string }[]; msm: number | null }[];
}

// ---------------------------------------------------------------- 参数

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) rest.push(a);
    else if (a === '--yes') flags.set('yes', '1');
    else flags.set(a.slice(2), argv[++i] ?? '');
  }
  const nearest = flags.get('nearest') ?? '3';
  const split = flags.get('split');
  const only = flags.get('cells');
  return {
    command: rest[0] ?? 'plan',
    opts: {
      nearest: nearest === 'all' ? ('all' as const) : Math.max(1, Number(nearest)),
      probes: Math.max(1, Number(flags.get('probes') ?? 2)),
      split: split === undefined ? DEFAULT_SPLIT : split === 'none' ? [] : split.split(',').map((s) => s.trim().toUpperCase()),
      excludeAsns: PROVIDERS.flatMap((p) => p.asns),
    },
    cells: only ? only.split(',').map((s) => s.trim().toUpperCase()) : null,
    maxCredits: flags.has('max-credits') ? Number(flags.get('max-credits')) : null,
    resume: flags.get('resume') ?? null,
    yes: flags.has('yes'),
  };
}

// ---------------------------------------------------------------- 数据

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

async function loadTargets(): Promise<BatchTarget[]> {
  const [network, targets] = await Promise.all([
    readJson<NetworkData>(path.join(DATA, 'network.json')),
    readJson<TargetsData>(path.join(DATA, 'targets.json')),
  ]);
  const regions = new Map(network.regions.map((r) => [r.id, r]));
  return targets.targets
    .filter((t) => regions.has(t.region))
    .map((t) => ({
      region: t.region,
      provider: t.provider,
      host: t.host,
      protocol: t.method === 'icmp' ? 'ICMP' : 'TCP',
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

type Admin1 = Feature<Geometry, { iso: string; labelLat: number; labelLng: number }>;

/** 起点地区：大国按省/州（探针落在哪个省界里），其余按国家。 */
async function buildCells(probes: BatchProbe[], split: string[]): Promise<BatchCell[]> {
  const topo = await readJson<Topology>(path.join(DATA, 'admin1.topo.json'));
  const admin1 = (feature(topo, topo.objects.admin1) as unknown as { features: Admin1[] }).features.filter((f) =>
    split.includes(f.properties.iso?.slice(0, 2)),
  );
  const boxes = admin1.map((f) => geoBounds(f));
  const inBox = (i: number, lat: number, lng: number) => {
    const [[w, s], [e, n]] = boxes[i];
    return lat >= s && lat <= n && (w <= e ? lng >= w && lng <= e : lng >= w || lng <= e);
  };

  const groups = new Map<string, BatchProbe[]>();
  for (const p of probes) {
    let key = p.cc;
    if (split.includes(p.cc)) {
      const same = admin1.map((f, i) => ({ f, i })).filter(({ f }) => f.properties.iso.startsWith(`${p.cc}-`));
      const hit = same.find(({ f, i }) => inBox(i, p.lat, p.lng) && geoContains(f, [p.lng, p.lat]));
      // 落在海岸线外（探针坐标不精确）时归到标注点最近的省
      const nearest = hit ?? same.sort((a, b) => haversineKm(p.lat, p.lng, a.f.properties.labelLat, a.f.properties.labelLng) - haversineKm(p.lat, p.lng, b.f.properties.labelLat, b.f.properties.labelLng))[0];
      if (nearest) key = nearest.f.properties.iso.toUpperCase();
    }
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }

  const label = new Map(admin1.map((f) => [f.properties.iso.toUpperCase(), f.properties]));
  return [...groups.entries()]
    .map(([id, list]) => {
      const l = label.get(id);
      return {
        id,
        country: list[0].cc,
        lat: l ? l.labelLat : median(list.map((p) => p.lat)),
        lng: l ? l.labelLng : median(list.map((p) => p.lng)),
        probes: list,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- plan

const fmt = (n: number) => n.toLocaleString('en-US');

function printTiers(cellsBySplit: Map<string, BatchCell[]>, targets: BatchTarget[], excludeAsns: number[]) {
  const tiers: { label: string; nearest: number | 'all'; probes: number; split: boolean }[] = [
    { label: '每家最近 1 个 · 1 探针 · 只按国家', nearest: 1, probes: 1, split: false },
    { label: '每家最近 2 个 · 2 探针 · 大国分省', nearest: 2, probes: 2, split: true },
    { label: '每家最近 3 个 · 2 探针 · 大国分省', nearest: 3, probes: 2, split: true },
    { label: '每家最近 3 个 · 3 探针 · 大国分省', nearest: 3, probes: 3, split: true },
    { label: '全部区域 · 1 探针 · 只按国家', nearest: 'all', probes: 1, split: false },
    { label: '全部区域 · 2 探针 · 大国分省', nearest: 'all', probes: 2, split: true },
  ];
  console.log(`\n参考档位（一次性 traceroute，每个结果 ${CREDITS_PER_RESULT} 积分）：`);
  for (const t of tiers) {
    const cells = cellsBySplit.get(t.split ? 'split' : 'none')!;
    const c = planCost(plan(cells, targets, { nearest: t.nearest, probes: t.probes, excludeAsns }));
    console.log(`  ${t.label.padEnd(24, '　')}  地区 ${String(cells.length).padStart(4)}  测量 ${String(c.measurements).padStart(4)}  结果 ${fmt(c.results).padStart(7)}  积分 ${fmt(c.credits).padStart(10)}`);
  }
}

function runId() {
  return new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
}

function toRunFile(id: string, opts: PlanOptions & { split: string[] }, cells: BatchCell[], planned: PlannedMeasurement[]): RunFile {
  const used = new Set(planned.flatMap((m) => m.probes.map((p) => p.cell)));
  const probes: RunFile['probes'] = {};
  for (const m of planned) for (const { probe } of m.probes) probes[probe.id] = { lat: probe.lat, lng: probe.lng, asn: probe.asn, cc: probe.cc };
  return {
    id,
    createdAt: new Date().toISOString(),
    options: opts,
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
        const transient = e.status === 429 || e.status === 503 || /simultaneous|concurrent|too many|rate/i.test(e.message);
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
  let pending = 0;
  let skipped = 0;
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
        // 同一地区同一区域以最新批次为准
        if (!pair || pair.run !== runIdx) pair = cell.regions[m.region] = { run: runIdx, msm: m.msm, target: m.host, at: 0, results: [] };
        const dest = t.hops.filter((h) => h.ip === t.dstAddr && h.minRtt !== null).at(-1);
        pair.results.push({ probe: p.id, rtt: t.reached && dest ? Math.round(dest.minRtt! * 10) / 10 : null });
        pair.at = Math.max(pair.at, t.timestamp);
      }
      process.stdout.write('.');
    }
    out.runs.push({ id: run.id, createdAt: run.createdAt, measurements: run.measurements.length, results, credits: results * CREDITS_PER_RESULT });
  }
  await writeFile(MEASURED, JSON.stringify(out) + '\n');
  const pairs = Object.values(out.cells).flatMap((c) => Object.values(c.regions));
  const rs = pairs.flatMap((p) => p.results);
  console.log(`\n写入 docs/measured.json：${Object.keys(out.cells).length} 个地区、${pairs.length} 个地区-区域组合、${rs.length} 个结果，到达目标 ${rs.filter((r) => r.rtt !== null).length} 个`);
  if (skipped) console.log(`跳过 ${skipped} 个来自被测云厂商网络内探针的结果`);
  if (pending) console.log(`还有 ${pending} 个探针没有返回结果（测量可能还在进行，稍后再 collect 一次）`);
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'collect') return collect();

  if (args.command === 'run' && args.resume) {
    const key = process.env.RIPE_ATLAS_KEY;
    if (!key) throw new Error('需要环境变量 RIPE_ATLAS_KEY');
    if (!args.yes) throw new Error('确认要花积分时加 --yes');
    const file = path.join(RUNS, `${args.resume}.json`);
    return createAll(await readJson<RunFile>(file), file, key);
  }

  console.log('读取区域和公开地址、拉取在线探针…');
  const [targets, probes] = await Promise.all([loadTargets(), fetchProbes()]);
  const allCells = await buildCells(probes, args.opts.split);
  const cells = args.cells ? allCells.filter((c) => args.cells!.includes(c.id)) : allCells;
  if (args.cells && cells.length !== args.cells.length) throw new Error(`找不到起点地区：${args.cells.filter((id) => !cells.some((c) => c.id === id)).join(',')}`);
  const planned = plan(cells, targets, args.opts);
  const cost = planCost(planned);
  console.log(`在线探针 ${fmt(probes.length)} 个，公开地址 ${targets.length} 个区域`);
  console.log(
    `本次选项：每家最近 ${args.opts.nearest} 个区域 · 每地区 ${args.opts.probes} 个探针 · 分省 ${args.opts.split.join(',') || '无'}`,
  );
  console.log(`起点地区 ${cells.length} 个 → 测量 ${cost.measurements} 个，结果 ${fmt(cost.results)} 个，约 ${fmt(cost.credits)} 积分`);

  if (args.command === 'plan') {
    const other = args.opts.split.length ? await buildCells(probes, []) : await buildCells(probes, DEFAULT_SPLIT);
    printTiers(new Map([[args.opts.split.length ? 'split' : 'none', allCells], [args.opts.split.length ? 'none' : 'split', other]]), targets, args.opts.excludeAsns);
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
  const run = toRunFile(id, args.opts, cells, planned);
  await writeFile(file, JSON.stringify(run, null, 1) + '\n');
  console.log(`批次 ${id}，计划已写入 ${path.relative(ROOT, file)}`);
  await createAll(run, file, key);
  console.log('全部创建完成。一次性测量通常 5–15 分钟内出结果，之后运行：node scripts/batch-measure.ts collect');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
