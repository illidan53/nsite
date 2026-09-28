// RIPE Atlas / IPmap / RIPEstat 公开 API 客户端（均支持浏览器跨域，无需 API key）。

import { haversineKm } from './geo.ts';
import type { AnchorProbe, AnchorRef } from './types.ts';

const ATLAS = 'https://atlas.ripe.net/api/v2';
const IPMAP = 'https://ipmap-api.ripe.net/v1';
const STAT = 'https://stat.ripe.net/data';
const SOURCE_APP = 'nsite-globe';

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json() as Promise<T>;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------- 探针

export interface ProbeInfo {
  id: number;
  lat: number;
  lng: number;
  asn: number | null;
  country: string;
  isAnchor: boolean;
  distanceKm: number;
}

interface ApiProbe {
  id: number;
  geometry: { coordinates: [number, number] } | null;
  asn_v4: number | null;
  country_code: string;
  is_anchor: boolean;
}

export async function probesNear(lat: number, lng: number, radiusKm: number, signal?: AbortSignal): Promise<ProbeInfo[]> {
  const url = `${ATLAS}/probes/?radius=${lat.toFixed(4)},${lng.toFixed(4)}:${Math.round(radiusKm)}&status=1&page_size=500&fields=id,geometry,asn_v4,country_code,is_anchor`;
  const d = await getJson<{ results: ApiProbe[] }>(url, signal);
  return d.results
    .filter((p) => p.geometry)
    .map((p) => {
      const [plng, plat] = p.geometry!.coordinates;
      return {
        id: p.id,
        lat: plat,
        lng: plng,
        asn: p.asn_v4,
        country: p.country_code,
        isAnchor: p.is_anchor,
        distanceKm: haversineKm(lat, lng, plat, plng),
      };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

// ---------------------------------------------------------------- traceroute / ping 结果

export interface TraceHop {
  hop: number;
  ip: string | null;
  rtts: number[];
  minRtt: number | null;
  sent: number;
  isPrivate: boolean;
}

export interface TraceResult {
  msmId: number;
  probeId: number;
  timestamp: number;
  srcAddr: string;
  dstAddr: string;
  reached: boolean;
  hops: TraceHop[];
}

interface ApiTraceroute {
  msm_id: number;
  prb_id: number;
  timestamp: number;
  from: string;
  src_addr: string;
  dst_addr: string;
  destination_ip_responded?: boolean;
  result: { hop: number; result?: { from?: string; rtt?: number; x?: string }[]; error?: string }[];
}

export function isPrivateIp(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4) return ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80');
  return (
    p[0] === 10 ||
    p[0] === 127 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 169 && p[1] === 254)
  );
}

export function parseTraceroute(r: ApiTraceroute): TraceResult {
  const hops: TraceHop[] = (r.result ?? []).map((h) => {
    const replies = (h.result ?? []).filter((x) => x.from && typeof x.rtt === 'number');
    // 一跳可能有多个应答地址（负载均衡），取出现最多的那个。
    const counts = new Map<string, number>();
    for (const x of replies) counts.set(x.from!, (counts.get(x.from!) ?? 0) + 1);
    const ip = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const rtts = replies.filter((x) => x.from === ip).map((x) => x.rtt!);
    return {
      hop: h.hop,
      ip,
      rtts,
      minRtt: rtts.length ? Math.min(...rtts) : null,
      sent: (h.result ?? []).length,
      isPrivate: ip ? isPrivateIp(ip) : false,
    };
  });
  const last = [...hops].reverse().find((h) => h.ip);
  return {
    msmId: r.msm_id,
    probeId: r.prb_id,
    timestamp: r.timestamp,
    srcAddr: r.src_addr || r.from,
    dstAddr: r.dst_addr,
    reached: r.destination_ip_responded ?? last?.ip === r.dst_addr,
    hops,
  };
}

export async function latestTraceroutes(msmId: number, probeIds: number[], signal?: AbortSignal): Promise<TraceResult[]> {
  if (!probeIds.length) return [];
  const url = `${ATLAS}/measurements/${msmId}/latest/?probe_ids=${probeIds.join(',')}`;
  const d = await getJson<ApiTraceroute[]>(url, signal);
  return d.map(parseTraceroute);
}

export interface PingResult {
  probeId: number;
  min: number | null;
  avg: number | null;
  timestamp: number;
}

export async function latestPing(msmId: number, probeId: number, signal?: AbortSignal): Promise<PingResult | null> {
  const d = await getJson<{ prb_id: number; min: number; avg: number; timestamp: number }[]>(
    `${ATLAS}/measurements/${msmId}/latest/?probe_ids=${probeId}`,
    signal,
  );
  const r = d[0];
  if (!r) return null;
  return { probeId: r.prb_id, min: r.min > 0 ? r.min : null, avg: r.avg > 0 ? r.avg : null, timestamp: r.timestamp };
}

// ---------------------------------------------------------------- 找离点击位置最近、且有结果的探针

export interface NearbyTrace {
  probe: ProbeInfo;
  trace: TraceResult;
}

/**
 * 在锚点的 anchoring 测量里找离 (lat, lng) 最近的发起探针。
 * anchoring mesh 测量由全部锚点发起，anchoring probes 测量由约 400 个普通探针发起，
 * 所以先把附近的锚点和普通探针都列出来，再按距离逐步扩大搜索半径。
 */
export async function findNearbyTraces(
  anchor: AnchorRef,
  lat: number,
  lng: number,
  anchorProbes: AnchorProbe[],
  signal?: AbortSignal,
  onProgress?: (msg: string) => void,
): Promise<NearbyTrace[]> {
  for (const radius of [500, 1500, 4000]) {
    onProgress?.(`查找 ${radius} km 内的 RIPE Atlas 探针…`);
    const regular = await probesNear(lat, lng, radius, signal);
    const anchors: ProbeInfo[] = anchorProbes
      .map((a) => ({
        id: a.probeId,
        lat: a.lat,
        lng: a.lng,
        asn: a.asn,
        country: a.country,
        isAnchor: true,
        distanceKm: haversineKm(lat, lng, a.lat, a.lng),
      }))
      .filter((a) => a.distanceKm <= radius && a.id !== anchor.probeId);
    const byId = new Map<number, ProbeInfo>();
    for (const p of [...anchors, ...regular]) if (p.id !== anchor.probeId) byId.set(p.id, p);
    const candidates = [...byId.values()].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 200);
    if (!candidates.length) continue;

    onProgress?.(`读取 ${candidates.length} 个探针到 ${anchor.fqdn} 的最新 traceroute…`);
    const ids = candidates.map((p) => p.id);
    const results = (await Promise.all(anchor.traceroute.map((m) => latestTraceroutes(m, ids, signal)))).flat();
    const found = new Map<number, NearbyTrace>();
    for (const t of results) {
      const probe = byId.get(t.probeId);
      if (!probe) continue;
      const prev = found.get(t.probeId);
      if (!prev || t.timestamp > prev.trace.timestamp) found.set(t.probeId, { probe, trace: t });
    }
    if (found.size) {
      return [...found.values()]
        .sort((a, b) => Number(b.trace.reached) - Number(a.trace.reached) || a.probe.distanceKm - b.probe.distanceKm)
        .slice(0, 8)
        .sort((a, b) => a.probe.distanceKm - b.probe.distanceKm);
    }
  }
  return [];
}

// ---------------------------------------------------------------- 跳点地理定位（IPmap）与归属网络（RIPEstat）

export interface IpLocation {
  city: string;
  country: string;
  lat: number;
  lng: number;
}

interface IpmapLocation {
  cityName?: string;
  countryName?: string;
  countryCodeAlpha2?: string;
  latitude?: number;
  longitude?: number;
}

export async function locateIps(ips: string[], signal?: AbortSignal): Promise<Map<string, IpLocation | null>> {
  const out = new Map<string, IpLocation | null>();
  const unique = [...new Set(ips)];
  for (let i = 0; i < unique.length; i += 20) {
    const batch = unique.slice(i, i + 20);
    try {
      const d = await getJson<{ data: Record<string, IpmapLocation | null> }>(
        `${IPMAP}/locate/all?resources=${batch.join(',')}`,
        signal,
      );
      for (const ip of batch) {
        const l = d.data?.[ip];
        out.set(
          ip,
          l && typeof l.latitude === 'number' && typeof l.longitude === 'number'
            ? { city: l.cityName ?? '', country: l.countryCodeAlpha2 ?? l.countryName ?? '', lat: l.latitude, lng: l.longitude }
            : null,
        );
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      for (const ip of batch) out.set(ip, null);
    }
  }
  return out;
}

export interface IpNetwork {
  asn: number | null;
  prefix: string | null;
  holder: string | null;
}

const holderCache = new Map<number, Promise<string | null>>();

function asHolder(asn: number, signal?: AbortSignal): Promise<string | null> {
  let p = holderCache.get(asn);
  if (!p) {
    p = getJson<{ data: { holder?: string } }>(`${STAT}/as-overview/data.json?resource=AS${asn}&sourceapp=${SOURCE_APP}`, signal)
      .then((d) => d.data.holder ?? null)
      .catch(() => null);
    holderCache.set(asn, p);
  }
  return p;
}

export async function networksForIps(ips: string[], signal?: AbortSignal): Promise<Map<string, IpNetwork>> {
  const unique = [...new Set(ips)];
  const infos = await mapLimit(unique, 4, async (ip) => {
    try {
      const d = await getJson<{ data: { asns: string[]; prefix: string | null } }>(
        `${STAT}/network-info/data.json?resource=${ip}&sourceapp=${SOURCE_APP}`,
        signal,
      );
      const asn = d.data.asns?.length ? Number(d.data.asns[0]) : null;
      return { ip, asn, prefix: d.data.prefix ?? null };
    } catch {
      return { ip, asn: null, prefix: null };
    }
  });
  const holders = new Map<number, string | null>();
  await mapLimit([...new Set(infos.map((i) => i.asn).filter((a): a is number => a !== null))], 4, async (asn) => {
    holders.set(asn, await asHolder(asn, signal));
  });
  return new Map(infos.map((i) => [i.ip, { asn: i.asn, prefix: i.prefix, holder: i.asn ? holders.get(i.asn) ?? null : null }]));
}
