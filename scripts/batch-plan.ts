// 批量站长实测的规划逻辑（纯函数，便于测试）：起点地区 → 探针 → 目标区域 → 按目标分组的一次性 traceroute。

import { haversineKm } from '../src/lib/geo.ts';

export interface BatchProbe {
  id: number;
  lat: number;
  lng: number;
  asn: number;
  cc: string;
  /** RIPE Atlas 的 system-ipv4-stable-1d 标签：过去一天 IPv4 一直在线。 */
  stable: boolean;
}

/** 起点地区：国家（ISO 3166-1）或大国的省/州（ISO 3166-2）。 */
export interface BatchCell {
  id: string;
  country: string;
  lat: number;
  lng: number;
  probes: BatchProbe[];
}

export interface BatchTarget {
  region: string;
  provider: string;
  host: string;
  protocol: 'ICMP' | 'TCP';
  lat: number;
  lng: number;
}

export interface PlanOptions {
  /** 每家厂商取离起点最近的几个区域；'all' 表示全部区域。 */
  nearest: number | 'all';
  /** 每个起点地区用几个探针。 */
  probes: number;
}

export interface PlannedMeasurement {
  target: BatchTarget;
  /** 探针 id → 所属起点地区。 */
  probes: { probe: BatchProbe; cell: string }[];
}

/** traceroute 每个结果 30 积分，一次性测量翻倍。 */
export const CREDITS_PER_RESULT = 60;
/** RIPE Atlas 每个测量最多 1000 个探针。 */
export const MAX_PROBES_PER_MEASUREMENT = 1000;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 离地区中心最近的 k 个探针：优先稳定在线的，尽量覆盖不同运营商（ASN）。 */
export function chooseProbes(cell: BatchCell, k: number): BatchProbe[] {
  const sorted = [...cell.probes].sort(
    (a, b) => Number(b.stable) - Number(a.stable) || haversineKm(cell.lat, cell.lng, a.lat, a.lng) - haversineKm(cell.lat, cell.lng, b.lat, b.lng),
  );
  const picked: BatchProbe[] = [];
  const asns = new Set<number>();
  for (const p of sorted) {
    if (picked.length >= k) break;
    if (asns.has(p.asn)) continue;
    asns.add(p.asn);
    picked.push(p);
  }
  for (const p of sorted) {
    if (picked.length >= k) break;
    if (!picked.includes(p)) picked.push(p);
  }
  return picked;
}

/** 每家厂商离起点最近的 n 个区域。 */
export function nearestTargets(cell: { lat: number; lng: number }, targets: BatchTarget[], n: number | 'all'): BatchTarget[] {
  if (n === 'all') return targets;
  const byProvider = new Map<string, BatchTarget[]>();
  for (const t of targets) {
    const list = byProvider.get(t.provider) ?? [];
    list.push(t);
    byProvider.set(t.provider, list);
  }
  const out: BatchTarget[] = [];
  for (const list of byProvider.values()) {
    list.sort((a, b) => haversineKm(cell.lat, cell.lng, a.lat, a.lng) - haversineKm(cell.lat, cell.lng, b.lat, b.lng));
    out.push(...list.slice(0, n));
  }
  return out;
}

/** 按目标区域分组：每个区域一个测量，探针来自所有把它列为目标的起点地区（超过 1000 个时拆开）。 */
export function plan(cells: BatchCell[], targets: BatchTarget[], opts: PlanOptions): PlannedMeasurement[] {
  const byRegion = new Map<string, PlannedMeasurement>();
  for (const cell of cells) {
    const probes = chooseProbes(cell, opts.probes);
    if (!probes.length) continue;
    for (const target of nearestTargets(cell, targets, opts.nearest)) {
      const m = byRegion.get(target.region) ?? { target, probes: [] };
      for (const probe of probes) m.probes.push({ probe, cell: cell.id });
      byRegion.set(target.region, m);
    }
  }
  const out: PlannedMeasurement[] = [];
  for (const m of byRegion.values()) {
    for (let i = 0; i < m.probes.length; i += MAX_PROBES_PER_MEASUREMENT) {
      out.push({ target: m.target, probes: m.probes.slice(i, i + MAX_PROBES_PER_MEASUREMENT) });
    }
  }
  return out;
}

export function planCost(measurements: PlannedMeasurement[]) {
  const results = measurements.reduce((s, m) => s + m.probes.length, 0);
  return { measurements: measurements.length, results, credits: results * CREDITS_PER_RESULT };
}
