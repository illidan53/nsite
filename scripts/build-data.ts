// 下载并预处理站点所需的全部静态数据，输出到 public/data/。
// 运行：npm run data（原始下载缓存在 .data-cache/，删除该目录即可强制刷新）。

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Feature, FeatureCollection, Geometry, Point, Polygon, MultiPolygon, Position } from 'geojson';
import { geoContains } from 'd3-geo';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile, sphericalTriangleArea } from 'topojson-simplify';
import { quantize } from 'topojson-client';
import type { Topology } from 'topojson-specification';

import { LandMask, haversineKm, polylineKm, type LngLat } from '../src/lib/geo.ts';
import { PROVIDERS } from '../src/lib/providers.ts';
import type {
  AnchorProbe,
  AnchorRef,
  Cable,
  Hub,
  LandGraph,
  LandingPoint,
  NetworkData,
  ProviderId,
  Region,
} from '../src/lib/types.ts';
import { EXTRA_REGIONS } from './extra-regions.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.data-cache');
const OUT = path.join(ROOT, 'public', 'data');

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const TG = 'https://www.submarinecablemap.com/api/v3';
const ATLAS = 'https://atlas.ripe.net/api/v2';
const CLOUD_REGIONS =
  'https://raw.githubusercontent.com/jasonwilbur/mcp-server-cloud-regions/HEAD/data/regions.json';

const log = (...a: unknown[]) => console.log('[data]', ...a);

// ---------------------------------------------------------------- 下载与缓存

async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchCached(url: string, name: string): Promise<string> {
  const file = path.join(CACHE, name);
  if (await exists(file)) return readFile(file, 'utf8');
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'nsite-build-data (https://github.com/illidan53)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const text = await res.text();
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text);
      return text;
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

const fetchJson = async <T>(url: string, name: string): Promise<T> => JSON.parse(await fetchCached(url, name)) as T;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

// ---------------------------------------------------------------- 行政区（Natural Earth）

function toTopo(fc: FeatureCollection, keepFraction: number, name: string): Topology {
  type SimplifiableTopology = Parameters<typeof presimplify>[0];
  let topo = topology({ [name]: fc }) as unknown as SimplifiableTopology;
  topo = presimplify(topo, sphericalTriangleArea);
  topo = simplify(topo, quantile(topo, keepFraction)); // quantile 按权重降序取，keepFraction 即保留点的比例
  return quantize(topo, 1e5) as unknown as Topology;
}

function pickProps(fc: FeatureCollection, pick: (p: Record<string, unknown>) => Record<string, unknown>): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => ({ ...f, properties: pick(f.properties ?? {}) })),
  };
}

// ---------------------------------------------------------------- 陆地位图

function rasterizeLand(land: FeatureCollection): LandMask {
  const mask = new LandMask();
  const rings: Position[][] = [];
  for (const f of land.features) {
    const g = f.geometry as Polygon | MultiPolygon;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const p of polys) rings.push(...p);
  }
  // 按纬度扫描线填充（偶奇规则）。Natural Earth 陆地多边形互不重叠，可以全局统一处理。
  const edges: [number, number, number, number][] = [];
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const [x1, y1] = ring[i - 1];
      const [x2, y2] = ring[i];
      if (y1 !== y2) edges.push([x1, y1, x2, y2]);
    }
  }
  for (let row = 0; row < LandMask.H; row++) {
    const lat = 90 - (row + 0.5) / LandMask.RES;
    const xs: number[] = [];
    for (const [x1, y1, x2, y2] of edges) {
      if ((y1 <= lat && lat < y2) || (y2 <= lat && lat < y1)) {
        xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.round((xs[k] + 180) * LandMask.RES));
      const c1 = Math.min(LandMask.W, Math.round((xs[k + 1] + 180) * LandMask.RES));
      for (let c = c0; c < c1; c++) mask.set(row, c);
    }
  }
  return mask;
}

// ---------------------------------------------------------------- 海缆（TeleGeography）

interface TgCableDetail {
  id: string;
  name: string;
  length: string | null;
  landing_points: { id: string; name: string; country: string; is_tbd: boolean | null }[];
  owners: string | null;
  rfs_year: number | null;
  is_planned: boolean;
  url: string | null;
}

async function buildCables(): Promise<{ cables: Cable[]; landingPoints: LandingPoint[] }> {
  const geo = await fetchJson<FeatureCollection>(`${TG}/cable/cable-geo.json`, 'tg/cable-geo.json');
  const lpGeo = await fetchJson<FeatureCollection>(`${TG}/landing-point/landing-point-geo.json`, 'tg/landing-point-geo.json');

  const linesById = new Map<string, { name: string; color: string; lines: LngLat[][] }>();
  for (const f of geo.features) {
    const p = f.properties as { id: string; name: string; color: string };
    const g = f.geometry as Geometry;
    const lines = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
    const entry = linesById.get(p.id) ?? { name: p.name, color: p.color, lines: [] };
    for (const l of lines) entry.lines.push(l.map(([x, y]) => [round4(x), round4(y)] as LngLat));
    linesById.set(p.id, entry);
  }

  const ids = [...linesById.keys()];
  log(`海缆详情 ${ids.length} 条（首次运行需要逐条下载）`);
  const details = await mapLimit(ids, 6, (id) =>
    fetchJson<TgCableDetail>(`${TG}/cable/${id}.json`, `tg/cable/${id}.json`).catch(() => null),
  );

  const lpCountry = new Map<string, string>();
  const cables: Cable[] = ids.map((id, i) => {
    const d = details[i];
    const g = linesById.get(id)!;
    for (const lp of d?.landing_points ?? []) lpCountry.set(lp.id, lp.country);
    const len = d?.length ? Number(d.length.replace(/[^\d.]/g, '')) : NaN;
    return {
      id,
      name: d?.name ?? g.name,
      color: g.color,
      planned: d?.is_planned ?? false,
      rfsYear: d?.rfs_year ?? null,
      lengthKm: Number.isFinite(len) && len > 0 ? len : null,
      drawnKm: Math.round(g.lines.reduce((s, l) => s + polylineKm(l), 0)),
      owners: d?.owners ?? '',
      url: d?.url ?? null,
      landingPoints: (d?.landing_points ?? []).map((lp) => lp.id),
      lines: g.lines,
    };
  });

  const landingPoints: LandingPoint[] = lpGeo.features.map((f) => {
    const p = f.properties as { id: string; name: string };
    const [lng, lat] = (f.geometry as Point).coordinates;
    return { id: p.id, name: p.name, country: lpCountry.get(p.id) ?? '', lat: round4(lat), lng: round4(lng) };
  });
  return { cables, landingPoints };
}

// ---------------------------------------------------------------- 云区域 + RIPE Atlas 锚点

interface UpstreamRegion {
  provider: string;
  regionCode: string;
  displayName: string;
  status: string;
  location: { country: string; countryCode: string; city: string; latitude: number; longitude: number };
}

interface AtlasAnchor {
  id: number;
  probe: number;
  fqdn: string;
  as_v4: number | null;
  ip_v4: string | null;
  city: string;
  country: string;
  company: string;
  is_disabled: boolean;
  geometry: { coordinates: [number, number] };
}

async function buildRegions(): Promise<{ regions: Region[]; anchorProbes: AnchorProbe[] }> {
  const upstream = await fetchJson<{ regions: UpstreamRegion[] }>(CLOUD_REGIONS, 'cloud-regions.json');
  const known = new Set<string>(PROVIDERS.map((p) => p.id));
  const regions: Region[] = upstream.regions
    .filter((r) => known.has(r.provider))
    .map((r) => ({
      id: `${r.provider}:${r.regionCode}`,
      provider: r.provider as ProviderId,
      code: r.regionCode,
      name: r.displayName,
      city: r.location.city,
      country: r.location.country,
      countryCode: r.location.countryCode,
      lat: r.location.latitude,
      lng: r.location.longitude,
      anchors: [],
    }));
  for (const r of EXTRA_REGIONS) {
    regions.push({ ...r, id: `${r.provider}:${r.code}`, anchors: [] });
  }

  // 锚点列表（含已下线的，逐页拉取）。
  const anchors: AtlasAnchor[] = [];
  let url: string | null = `${ATLAS}/anchors/?page_size=500`;
  for (let page = 1; url; page++) {
    const d: { next: string | null; results: AtlasAnchor[] } = await fetchJson(url, `atlas/anchors-${page}.json`);
    anchors.push(...d.results);
    url = d.next;
  }
  const live = anchors.filter((a) => !a.is_disabled && a.ip_v4 && a.as_v4);
  log(`RIPE Atlas 锚点：在线 IPv4 ${live.length} 个`);

  // 同厂商锚点只归给该厂商最近的区域；非同厂商的锚点作为“同城参考”，限定 60 km 内。
  const candidates = new Map<string, { a: AtlasAnchor; d: number; same: boolean }[]>();
  for (const a of live) {
    const [lng, lat] = a.geometry.coordinates;
    const owner = PROVIDERS.find((p) => p.asns.includes(a.as_v4!));
    let bestSame: { r: Region; d: number } | null = null;
    for (const r of regions) {
      const d = haversineKm(lat, lng, r.lat, r.lng);
      if (owner && r.provider === owner.id) {
        if (d < 400 && (!bestSame || d < bestSame.d)) bestSame = { r, d };
      } else if (d < 60) {
        const list = candidates.get(r.id) ?? [];
        list.push({ a, d, same: false });
        candidates.set(r.id, list);
      }
    }
    if (bestSame) {
      const list = candidates.get(bestSame.r.id) ?? [];
      list.push({ a, d: bestSame.d, same: true });
      candidates.set(bestSame.r.id, list);
    }
  }

  const chosen = new Map<number, AtlasAnchor>();
  for (const r of regions) {
    const list = (candidates.get(r.id) ?? []).sort((x, y) => Number(y.same) - Number(x.same) || x.d - y.d).slice(0, 3);
    for (const c of list) chosen.set(c.a.id, c.a);
    r.anchors = list.map(({ a, d, same }) => ({
      id: a.id,
      probeId: a.probe,
      fqdn: a.fqdn,
      asn: a.as_v4!,
      company: a.company,
      city: a.city,
      lat: a.geometry.coordinates[1],
      lng: a.geometry.coordinates[0],
      distanceKm: Math.round(d),
      sameProvider: same,
      traceroute: [],
      ping: [],
    }));
  }

  log(`为 ${chosen.size} 个锚点查询持续运行的 anchoring 测量`);
  const msms = new Map<number, { traceroute: number[]; ping: number[] }>();
  await mapLimit([...chosen.values()], 4, async (a) => {
    const d = await fetchJson<{ results: { id: number; type: string; description: string }[] }>(
      `${ATLAS}/measurements/?target=${a.fqdn}&status=2&af=4&page_size=50&fields=id,type,description`,
      `atlas/msm-${a.id}.json`,
    );
    const anchoring = d.results.filter((m) => m.description?.startsWith('Anchoring'));
    msms.set(a.id, {
      traceroute: anchoring.filter((m) => m.type === 'traceroute').map((m) => m.id),
      ping: anchoring.filter((m) => m.type === 'ping').map((m) => m.id),
    });
  });
  for (const r of regions) {
    r.anchors = r.anchors
      .map((ref): AnchorRef => ({ ...ref, ...msms.get(ref.id)! }))
      .filter((ref) => ref.traceroute.length > 0);
  }

  const anchorProbes: AnchorProbe[] = live.map((a) => ({
    probeId: a.probe,
    lat: a.geometry.coordinates[1],
    lng: a.geometry.coordinates[0],
    city: a.city,
    country: a.country,
    asn: a.as_v4!,
  }));
  return { regions, anchorProbes };
}

// ---------------------------------------------------------------- 陆地骨干近似图

interface TNode {
  key: string;
  lat: number;
  lng: number;
  hub: boolean;
}

function buildLandGraph(nodes: TNode[], land: LandMask): LandGraph {
  const edges = new Map<string, [number, number, number]>();
  const valid = new Map<string, boolean>();
  const pairKey = (i: number, j: number) => (i < j ? `${i}-${j}` : `${j}-${i}`);
  const check = (i: number, j: number) => {
    const k = pairKey(i, j);
    let v = valid.get(k);
    if (v === undefined) {
      v = land.overlandPath([nodes[i].lng, nodes[i].lat], [nodes[j].lng, nodes[j].lat], 12, 15);
      valid.set(k, v);
    }
    return v;
  };
  const add = (i: number, j: number, km: number) => edges.set(pairKey(i, j), [Math.min(i, j), Math.max(i, j), Math.round(km * 10) / 10]);

  const LOCAL_KM = 30;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const near = nodes
      .map((b, j) => ({ j, d: j === i ? Infinity : haversineKm(a.lat, a.lng, b.lat, b.lng) }))
      .filter((x) => x.d < 3000)
      .sort((x, y) => x.d - y.d);

    // 同一城市/园区内的节点全部互连（不计入 K 近邻，否则同城重复节点会占满名额）。
    for (const { j, d } of near) {
      if (d >= LOCAL_KM) break;
      add(i, j, d);
    }
    const pick = (filter: (n: TNode) => boolean, k: number, maxKm: number) => {
      let found = 0;
      for (const { j, d } of near) {
        if (found >= k || d > maxKm) break;
        if (d < LOCAL_KM || !filter(nodes[j])) continue;
        if (check(i, j)) {
          add(i, j, d);
          found++;
        }
      }
      return found;
    };
    if (a.hub) {
      if (pick((n) => n.hub, 6, 1500) < 3) pick((n) => n.hub, 3, 3000);
    } else {
      if (pick((n) => n.hub, 3, 1500) === 0) pick((n) => n.hub, 1, 3000);
      pick((n) => !n.hub, 2, 400);
    }
  }
  return { nodes: nodes.map((n) => n.key), edges: [...edges.values()] };
}

// ---------------------------------------------------------------- 主流程

async function main() {
  await mkdir(OUT, { recursive: true });

  log('Natural Earth 国家、省级行政区、陆地、城市');
  const countries = await fetchJson<FeatureCollection>(`${NE}/ne_50m_admin_0_countries.geojson`, 'ne/admin0-50m.geojson');
  const admin1 = await fetchJson<FeatureCollection>(`${NE}/ne_10m_admin_1_states_provinces.geojson`, 'ne/admin1-10m.geojson');
  const landFc = await fetchJson<FeatureCollection>(`${NE}/ne_50m_land.geojson`, 'ne/land-50m.geojson');
  const places = await fetchJson<FeatureCollection>(`${NE}/ne_50m_populated_places.geojson`, 'ne/places-50m.geojson');

  // Natural Earth 的中文名有几处是正式国号或带政治立场的写法，界面上统一用通行简称。
  const ZH_OVERRIDES: Record<string, string> = { CHN: '中国', TWN: '台湾', CYN: '北塞浦路斯' };
  const countriesSlim = pickProps(countries, (p) => ({
    name: p.NAME,
    nameZh: ZH_OVERRIDES[String(p.ADM0_A3)] ?? p.NAME_ZH,
    iso2: p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2,
    iso3: p.ADM0_A3,
    continent: p.CONTINENT,
  }));
  await writeFile(path.join(OUT, 'countries.topo.json'), JSON.stringify(toTopo(countriesSlim, 0.3, 'countries')));

  const admin1Slim = pickProps(admin1, (p) => ({
    name: p.name,
    nameZh: p.name_zh,
    iso: p.iso_3166_2,
    adm0: p.adm0_a3,
    type: p.type_en,
  }));
  await writeFile(path.join(OUT, 'admin1.topo.json'), JSON.stringify(toTopo(admin1Slim, 0.12, 'admin1')));

  const land = rasterizeLand(landFc);
  await writeFile(path.join(OUT, 'landmask.bin'), land.bits);

  const hubs: Hub[] = places.features
    .filter((f) => {
      const p = f.properties!;
      return String(p.FEATURECLA).includes('Admin-0 capital') || Number(p.POP_MAX) >= 1_000_000;
    })
    .map((f, i) => {
      const p = f.properties!;
      const [lng, lat] = (f.geometry as Point).coordinates;
      return { id: `city:${i}`, name: String(p.NAME), nameZh: String(p.NAME_ZH ?? p.NAME), country: String(p.ADM0NAME), lat: round4(lat), lng: round4(lng) };
    });
  log(`枢纽城市 ${hubs.length} 个`);

  log('TeleGeography 海缆');
  const { cables, landingPoints } = await buildCables();
  log(`海缆 ${cables.length} 条（在役 ${cables.filter((c) => !c.planned).length}），登陆站 ${landingPoints.length} 个`);

  log('云区域 + RIPE Atlas');
  const { regions, anchorProbes } = await buildRegions();
  log(`云区域 ${regions.length} 个，其中 ${regions.filter((r) => r.anchors.length).length} 个有同城/同网锚点`);

  // 校验：区域坐标是否落在其声明的国家内（只告警）。
  for (const r of regions) {
    const hit = countriesSlim.features.find((f) => geoContains(f as Feature, [r.lng, r.lat]));
    const iso = hit?.properties?.iso2;
    if (iso && iso !== r.countryCode) log(`  ⚠ ${r.id} 声明 ${r.countryCode}，坐标落在 ${iso}`);
    if (!hit && !land.nearLand(r.lng, r.lat, 30)) log(`  ⚠ ${r.id} 坐标不在陆地上`);
  }

  log('构建陆地骨干近似图');
  const usedLps = new Set(cables.flatMap((c) => c.landingPoints));
  const tnodes: TNode[] = [
    ...hubs.map((h) => ({ key: h.id, lat: h.lat, lng: h.lng, hub: true })),
    ...regions.map((r) => ({ key: `dc:${r.id}`, lat: r.lat, lng: r.lng, hub: true })),
    ...landingPoints.filter((lp) => usedLps.has(lp.id)).map((lp) => ({ key: `lp:${lp.id}`, lat: lp.lat, lng: lp.lng, hub: false })),
  ];
  const landGraph = buildLandGraph(tnodes, land);
  log(`陆地图：节点 ${landGraph.nodes.length}，边 ${landGraph.edges.length}`);

  const data: NetworkData = {
    regions,
    cables,
    landingPoints,
    hubs,
    landGraph,
    anchorProbes,
    meta: {
      builtAt: new Date().toISOString(),
      sources: [
        { name: 'TeleGeography Submarine Cable Map', url: 'https://www.submarinecablemap.com/', license: 'CC BY-NC-SA 3.0' },
        { name: 'Natural Earth', url: 'https://www.naturalearthdata.com/', license: 'Public domain' },
        { name: 'cloud-regions (jasonwilbur/mcp-server-cloud-regions)', url: 'https://github.com/jasonwilbur/mcp-server-cloud-regions', license: 'MIT' },
        { name: 'RIPE Atlas', url: 'https://atlas.ripe.net/', license: 'RIPE Atlas Terms of Service' },
      ],
    },
  };
  await writeFile(path.join(OUT, 'network.json'), JSON.stringify(data));
  for (const f of ['network.json', 'countries.topo.json', 'admin1.topo.json', 'landmask.bin']) {
    const s = await stat(path.join(OUT, f));
    log(`  ${f}: ${(s.size / 1024).toFixed(0)} KB`);
  }
  log('完成');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
