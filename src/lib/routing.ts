// 物理路径估算：海缆（TeleGeography 真实走向）+ 陆地骨干（沿陆地的大圆 × 绕路系数）组成的图上跑 Dijkstra。
// 它给出的是“光在光纤里走这条物理路径需要多久”，实际路由还受 BGP、运营商互联、国际出口影响，只作参考。

import { greatCirclePoints, haversineKm, LandMask, type LngLat } from './geo.ts';
import type { Cable, NetworkData, Region } from './types.ts';

/** 光在光纤中的速度（折射率约 1.468）：每毫秒约 204 km。 */
export const FIBER_KM_PER_MS = 299_792.458 / 1.468 / 1000;
/** 陆地光缆沿公路、铁路铺设，实际长度约为大圆距离的 1.4 倍（经验值）。 */
export const LAND_INFLATION = 1.4;
/** 海缆官方长度未知时，相对绘制路径的默认放大系数。 */
export const DEFAULT_CABLE_SCALE = 1.15;
/** 接入网（家宽/移动网络最后一公里）的往返时延假设。 */
export const ACCESS_RTT_MS = 4;
/** 每条陆地边加一点代价，避免在几乎等长的陆地路径之间绕圈。只影响选路，不计入时延。 */
const HOP_PENALTY_MS = 0.02;
/** 每次上下一条海缆（登陆站交接）的选路代价，避免在一串短海缆之间跳来跳去。不计入时延。 */
const CABLE_ENTRY_PENALTY_MS = 1;

export type NodeKind = 'origin' | 'city' | 'dc' | 'lp' | 'cv';

export interface GNode {
  key: string;
  kind: NodeKind;
  lat: number;
  lng: number;
  /** 英文名；中文名只有城市和阿里云/腾讯云区域才有。显示时按语言选择。 */
  name: string;
  nameZh?: string;
  /** 数据中心的区域代码。 */
  code?: string;
}

/** 分段两端的节点描述（不含坐标），界面按当前语言渲染。 */
export type SegmentEnd = Pick<GNode, 'kind' | 'name' | 'nameZh' | 'code'>;

interface GEdge {
  to: number;
  km: number;
  ms: number;
  kind: 'land' | 'sub';
  cable?: number;
  /** 登陆站与海缆之间的连接边。 */
  attach?: boolean;
}

export interface RouteGraph {
  nodes: GNode[];
  adj: GEdge[][];
  index: Map<string, number>;
  cables: Cable[];
  land: LandMask;
}

export interface Segment {
  kind: 'access' | 'land' | 'sub';
  from: SegmentEnd | null;
  to: SegmentEnd | null;
  km: number;
  /** 单程时延（ms）。往返贡献为 2 倍。 */
  oneWayMs: number;
  cable?: Cable;
  coords: LngLat[];
}

export interface EstimatedRoute {
  segments: Segment[];
  rttMs: number;
  km: number;
  /** 直线大圆距离下的理论最低 RTT。 */
  floorRttMs: number;
}

const cableScale = (c: Cable) =>
  c.lengthKm && c.drawnKm > 0 ? Math.min(1.5, Math.max(1, c.lengthKm / c.drawnKm)) : DEFAULT_CABLE_SCALE;

export function buildRouteGraph(data: NetworkData, land: LandMask): RouteGraph {
  const nodes: GNode[] = [];
  const adj: GEdge[][] = [];
  const index = new Map<string, number>();
  const addNode = (n: GNode) => {
    const existing = index.get(n.key);
    if (existing !== undefined) return existing;
    index.set(n.key, nodes.length);
    nodes.push(n);
    adj.push([]);
    return nodes.length - 1;
  };
  const link = (a: number, b: number, km: number, kind: 'land' | 'sub', cable?: number, attach?: boolean) => {
    const ms = km / FIBER_KM_PER_MS;
    adj[a].push({ to: b, km, ms, kind, cable, attach });
    adj[b].push({ to: a, km, ms, kind, cable, attach });
  };

  for (const h of data.hubs) {
    addNode({ key: h.id, kind: 'city', lat: h.lat, lng: h.lng, name: h.name, nameZh: h.nameZh !== h.name ? h.nameZh : undefined });
  }
  for (const r of data.regions) {
    addNode({ key: `dc:${r.id}`, kind: 'dc', lat: r.lat, lng: r.lng, name: r.name, nameZh: r.nameZh, code: r.code });
  }
  const lpById = new Map(data.landingPoints.map((lp) => [lp.id, lp]));
  for (const lp of data.landingPoints) {
    addNode({ key: `lp:${lp.id}`, kind: 'lp', lat: lp.lat, lng: lp.lng, name: lp.name });
  }

  // 陆地骨干
  for (const [a, b, km] of data.landGraph.edges) {
    const ia = index.get(data.landGraph.nodes[a]);
    const ib = index.get(data.landGraph.nodes[b]);
    if (ia !== undefined && ib !== undefined) link(ia, ib, km * LAND_INFLATION, 'land');
  }

  // 海缆：每条在役海缆各自的顶点图（不同海缆在海上不互通），再把登陆站挂到最近的顶点上。
  data.cables.forEach((c, ci) => {
    if (c.planned) return;
    const scale = cableScale(c);
    const verts: number[] = [];
    for (const line of c.lines) {
      let prev = -1;
      for (const [lng, lat] of line) {
        // TeleGeography 在 180° 经线处把线段切开（-180 与 180 两个点），合并为同一顶点，否则跨太平洋海缆会断开。
        const keyLng = Math.abs(lng) > 179.99 ? 180 : lng;
        const v = addNode({ key: `cv:${ci}:${keyLng},${lat}`, kind: 'cv', lat, lng, name: c.name });
        if (prev >= 0 && prev !== v) {
          const p = nodes[prev];
          link(prev, v, haversineKm(p.lat, p.lng, lat, lng) * scale, 'sub', ci);
        }
        verts.push(v);
        prev = v;
      }
    }
    for (const lpId of c.landingPoints) {
      const lp = lpById.get(lpId);
      if (!lp) continue;
      let best = -1;
      let bestKm = Infinity;
      for (const v of verts) {
        const d = haversineKm(lp.lat, lp.lng, nodes[v].lat, nodes[v].lng);
        if (d < bestKm) [best, bestKm] = [v, d];
      }
      if (best >= 0 && bestKm < 100) link(index.get(`lp:${lpId}`)!, best, bestKm, 'sub', ci, true);
    }
  });

  return { nodes, adj, index, cables: data.cables, land };
}

// ---------------------------------------------------------------- Dijkstra

class MinHeap {
  private items: [number, number][] = [];
  get size() {
    return this.items.length;
  }
  push(item: [number, number]) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export interface ShortestPaths {
  origin: number;
  /** 选路权重（含跳数惩罚）。 */
  dist: Float64Array;
  /** 最短路径上的纯单程时延（ms）。 */
  ms: Float64Array;
  prev: Int32Array;
  prevEdge: (GEdge | null)[];
}

/** 临时接入图中的点：点击起点，以及计算 traceroute 相邻两跳之间路径时的两端。 */
const TEMP_KEYS = ['origin', 'leg:a', 'leg:b'] as const;
type TempKey = (typeof TEMP_KEYS)[number];

function detachPoint(g: RouteGraph, key: TempKey): number | undefined {
  const i = g.index.get(key);
  if (i === undefined) return undefined;
  for (const e of g.adj[i]) g.adj[e.to] = g.adj[e.to].filter((x) => x.to !== i);
  g.adj[i] = [];
  return i;
}

function tempNodes(g: RouteGraph): Set<number> {
  return new Set(TEMP_KEYS.map((k) => g.index.get(k)).filter((i): i is number => i !== undefined));
}

/** 把一个临时点接入图：30 km 内有枢纽城市或机房就只接本地，否则接最近几个能走陆路到达的枢纽和登陆站。 */
function attachPoint(g: RouteGraph, key: TempKey, lat: number, lng: number): number {
  const idx =
    detachPoint(g, key) ??
    (() => {
      g.index.set(key, g.nodes.length);
      g.nodes.push({ key, kind: 'origin', lat, lng, name: 'Origin' });
      g.adj.push([]);
      return g.nodes.length - 1;
    })();
  g.nodes[idx] = { ...g.nodes[idx], lat, lng };

  const temp = tempNodes(g);
  const near = g.nodes
    .map((n, i) => ({ i, n, d: n.kind === 'cv' || temp.has(i) ? Infinity : haversineKm(lat, lng, n.lat, n.lng) }))
    .filter((x) => x.d < 3000)
    .sort((a, b) => a.d - b.d);
  const connect = (i: number, d: number) => {
    const km = d * LAND_INFLATION;
    const ms = km / FIBER_KM_PER_MS;
    g.adj[idx].push({ to: i, km, ms, kind: 'land' });
    g.adj[i].push({ to: idx, km, ms, kind: 'land' });
  };
  // 附近 30 km 内有枢纽城市或机房时只接入本地节点，路径展示更贴近“先到本地骨干”。
  const local = near.filter((x) => x.d < 30);
  for (const { i, d } of local) connect(i, d);
  const hasLocalHub = local.some((x) => x.n.kind === 'city' || x.n.kind === 'dc');
  let hubs = 0;
  let lps = 0;
  for (const { i, n, d } of hasLocalHub ? [] : near) {
    if (d < 30) continue;
    const isHub = n.kind === 'city' || n.kind === 'dc';
    if ((isHub && hubs >= 4) || (!isHub && lps >= 2)) {
      if (hubs >= 4 && lps >= 2) break;
      continue;
    }
    if (d > (isHub ? (hubs === 0 ? 3000 : 1500) : 400)) continue;
    if (!g.land.overlandPath([lng, lat], [n.lng, n.lat], 5)) continue;
    connect(i, d);
    if (isHub) hubs++;
    else lps++;
  }
  return idx;
}

/** 单源最短路；不经过其它临时点（它们只是起终点，不是网络节点）。给了 target 时到达即停。 */
function dijkstra(g: RouteGraph, source: number, target?: number): ShortestPaths {
  const blocked = tempNodes(g);
  blocked.delete(source);
  if (target !== undefined) blocked.delete(target);
  const n = g.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const ms = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const prevEdge: (GEdge | null)[] = new Array(n).fill(null);
  dist[source] = 0;
  ms[source] = 0;
  const heap = new MinHeap();
  heap.push([0, source]);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    if (u === target) break;
    for (const e of g.adj[u]) {
      if (blocked.has(e.to)) continue;
      const nd = d + e.ms + (e.kind === 'land' ? HOP_PENALTY_MS : 0) + (e.attach ? CABLE_ENTRY_PENALTY_MS / 2 : 0);
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        ms[e.to] = ms[u] + e.ms;
        prev[e.to] = u;
        prevEdge[e.to] = e;
        heap.push([nd, e.to]);
      }
    }
  }
  return { origin: source, dist, ms, prev, prevEdge };
}

/**
 * 把点击位置作为临时起点接入图中，然后跑单源最短路。
 * 点击位置不在陆地上时返回 null。
 */
export function shortestFrom(g: RouteGraph, lat: number, lng: number): ShortestPaths | null {
  if (!g.land.nearLand(lng, lat, 5)) return null;
  return dijkstra(g, attachPoint(g, 'origin', lat, lng));
}

/** 最短路上到 target 的各段（相邻的同一条海缆合并成一段）。 */
function extractSegments(g: RouteGraph, sp: ShortestPaths, target: number): Segment[] {
  const path: { node: number; edge: GEdge | null }[] = [];
  for (let v = target; v !== -1; v = sp.prev[v]) path.unshift({ node: v, edge: sp.prevEdge[v] });

  const end = (n: GNode): SegmentEnd => ({ kind: n.kind, name: n.name, nameZh: n.nameZh, code: n.code });
  const segments: Segment[] = [];
  for (let k = 1; k < path.length; k++) {
    const e = path[k].edge!;
    const a = g.nodes[path[k - 1].node];
    const b = g.nodes[path[k].node];
    const last = segments[segments.length - 1];
    if (e.kind === 'sub' && last?.kind === 'sub' && last.cable === g.cables[e.cable!] && a.kind === 'cv') {
      last.km += e.km;
      last.oneWayMs += e.ms;
      last.coords.push([b.lng, b.lat]);
      last.to = end(b);
    } else if (e.kind === 'sub') {
      segments.push({
        kind: 'sub',
        from: end(a),
        to: end(b),
        km: e.km,
        oneWayMs: e.ms,
        cable: g.cables[e.cable!],
        coords: [
          [a.lng, a.lat],
          [b.lng, b.lat],
        ],
      });
    } else {
      segments.push({
        kind: 'land',
        from: end(a),
        to: end(b),
        km: e.km,
        oneWayMs: e.ms,
        coords: greatCirclePoints([a.lng, a.lat], [b.lng, b.lat], 50),
      });
    }
  }
  return segments;
}

/** 从最短路结果中取出到某区域的路径，并合并成可读的分段。 */
export function routeTo(g: RouteGraph, sp: ShortestPaths, region: Region): EstimatedRoute | null {
  const target = g.index.get(`dc:${region.id}`);
  if (target === undefined || !Number.isFinite(sp.dist[target])) return null;

  const origin = g.nodes[sp.origin];
  const segments: Segment[] = [
    { kind: 'access', from: null, to: null, km: 0, oneWayMs: ACCESS_RTT_MS / 2, coords: [] },
    ...extractSegments(g, sp, target),
  ];
  const oneWay = segments.reduce((s, x) => s + x.oneWayMs, 0);
  const gc = haversineKm(origin.lat, origin.lng, region.lat, region.lng);
  return {
    segments,
    rttMs: 2 * oneWay,
    km: segments.reduce((s, x) => s + x.km, 0),
    floorRttMs: (2 * gc) / FIBER_KM_PER_MS,
  };
}

/** traceroute 相邻两个已定位跳之间推测的物理路径。 */
export interface PhysicalLeg {
  /** direct：两点很近；land：走陆路；sub：至少经过一段海缆；unknown：图里找不到（按大圆画）。 */
  kind: 'direct' | 'land' | 'sub' | 'unknown';
  km: number;
  /** 这条路径的理论往返时延（光纤光速）。 */
  rttMs: number;
  coords: LngLat[];
  cables: Cable[];
}

/** 两段之间直接相连的阈值：更近的两跳直接连线。 */
const DIRECT_KM = 150;

/**
 * 两个地点之间最可能的物理路径：大圆基本在陆地上就走陆路，否则在海缆 + 陆地图里找最短路径。
 * traceroute 只知道路由器在哪，不知道中间走哪条光缆，所以这只是推测。
 */
export function pathBetween(g: RouteGraph, a: { lat: number; lng: number }, b: { lat: number; lng: number }): PhysicalLeg {
  const gc = haversineKm(a.lat, a.lng, b.lat, b.lng);
  const straight = (kind: PhysicalLeg['kind'], factor: number): PhysicalLeg => ({
    kind,
    km: gc * factor,
    rttMs: (2 * gc * factor) / FIBER_KM_PER_MS,
    coords: greatCirclePoints([a.lng, a.lat], [b.lng, b.lat], 50),
    cables: [],
  });
  if (gc < DIRECT_KM) return straight('direct', 1);
  if (g.land.overlandPath([a.lng, a.lat], [b.lng, b.lat])) return straight('land', LAND_INFLATION);
  if (!g.land.nearLand(a.lng, a.lat, 50) || !g.land.nearLand(b.lng, b.lat, 50)) return straight('unknown', 1);

  const ia = attachPoint(g, 'leg:a', a.lat, a.lng);
  const ib = attachPoint(g, 'leg:b', b.lat, b.lng);
  try {
    const sp = dijkstra(g, ia, ib);
    if (!Number.isFinite(sp.dist[ib])) return straight('unknown', 1);
    const segments = extractSegments(g, sp, ib);
    const cables = [...new Set(segments.filter((s) => s.cable).map((s) => s.cable!))];
    const coords: LngLat[] = [];
    for (const s of segments) {
      const first = coords[coords.length - 1];
      coords.push(...(first && first[0] === s.coords[0][0] && first[1] === s.coords[0][1] ? s.coords.slice(1) : s.coords));
    }
    return {
      kind: cables.length ? 'sub' : 'land',
      km: segments.reduce((sum, s) => sum + s.km, 0),
      rttMs: 2 * segments.reduce((sum, s) => sum + s.oneWayMs, 0),
      coords,
      cables,
    };
  } finally {
    detachPoint(g, 'leg:a');
    detachPoint(g, 'leg:b');
  }
}

/** 到某区域的估算 RTT（不展开路径）。不可达时退化为大圆 × 1.5。 */
export function estimateRtt(g: RouteGraph, sp: ShortestPaths | null, region: Region, lat: number, lng: number): number {
  const target = g.index.get(`dc:${region.id}`);
  if (sp && target !== undefined && Number.isFinite(sp.ms[target])) return 2 * sp.ms[target] + ACCESS_RTT_MS;
  return (2 * haversineKm(lat, lng, region.lat, region.lng) * 1.5) / FIBER_KM_PER_MS + ACCESS_RTT_MS;
}
