import { describe, expect, it } from 'vitest';
import { LandMask, haversineKm } from './geo.ts';
import { ACCESS_RTT_MS, FIBER_KM_PER_MS, LAND_INFLATION, buildRouteGraph, estimateRtt, pathBetween, routeTo, shortestFrom } from './routing.ts';
import type { NetworkData, Region } from './types.ts';

// 两块“大陆”，中间隔着海：西大陆 lng 0..10，东大陆 lng 20..30，纬度 0..10。
function makeLand() {
  const mask = new LandMask();
  for (let row = 80 * LandMask.RES; row < 90 * LandMask.RES; row++) {
    for (const [c0, c1] of [
      [180, 190],
      [200, 210],
    ]) {
      for (let col = c0 * LandMask.RES; col < c1 * LandMask.RES; col++) mask.set(row, col);
    }
  }
  return mask;
}

const region = (id: string, lat: number, lng: number): Region => ({
  id,
  provider: 'aws',
  code: id,
  name: id,
  city: id,
  country: 'X',
  countryCode: 'XX',
  lat,
  lng,
  anchors: [],
});

function makeData(cableScaleKm?: number): NetworkData {
  const west = region('aws:west', 5, 5);
  const east = region('aws:east', 5, 25);
  return {
    regions: [west, east],
    hubs: [],
    landingPoints: [
      { id: 'lp-w', name: 'West LP', country: 'X', lat: 5, lng: 9.95 },
      { id: 'lp-e', name: 'East LP', country: 'X', lat: 5, lng: 20.05 },
    ],
    cables: [
      {
        id: 'c1',
        name: 'Test Cable',
        color: '#00ffff',
        planned: false,
        rfsYear: 2020,
        lengthKm: cableScaleKm ?? null,
        drawnKm: 1107,
        owners: 'Test',
        url: null,
        landingPoints: ['lp-w', 'lp-e'],
        lines: [
          [
            [9.95, 5],
            [15, 4],
            [20.05, 5],
          ],
        ],
      },
    ],
    landGraph: {
      nodes: ['dc:aws:west', 'lp:lp-w', 'dc:aws:east', 'lp:lp-e'],
      edges: [
        [0, 1, haversineKm(5, 5, 5, 9.95)],
        [2, 3, haversineKm(5, 25, 5, 20.05)],
      ],
    },
    anchorProbes: [],
    meta: { builtAt: '', sources: [] },
  };
}

describe('routing', () => {
  it('routes across the ocean only via the cable', () => {
    const data = makeData();
    const g = buildRouteGraph(data, makeLand());
    const sp = shortestFrom(g, 5, 4)!;
    expect(sp).not.toBeNull();
    const route = routeTo(g, sp, data.regions[1])!;
    const kinds = route.segments.map((s) => s.kind);
    expect(kinds[0]).toBe('access');
    expect(kinds).toContain('sub');
    const sub = route.segments.find((s) => s.kind === 'sub')!;
    expect(sub.cable?.name).toBe('Test Cable');
    expect(sub.from?.name).toBe('West LP');
    expect(sub.to?.name).toBe('East LP');
  });

  it('computes RTT as twice the one-way fiber delay plus access', () => {
    const data = makeData();
    const g = buildRouteGraph(data, makeLand());
    const sp = shortestFrom(g, 5, 5)!;
    const route = routeTo(g, sp, data.regions[1])!;
    const oneWay = route.segments.reduce((s, x) => s + x.oneWayMs, 0);
    expect(route.rttMs).toBeCloseTo(2 * oneWay, 6);
    expect(estimateRtt(g, sp, data.regions[1], 5, 5)).toBeCloseTo(route.rttMs, 6);
    // 路径不可能比直线大圆更短
    expect(route.rttMs).toBeGreaterThan(route.floorRttMs);
    expect(route.floorRttMs).toBeCloseTo((2 * haversineKm(5, 5, 5, 25)) / FIBER_KM_PER_MS, 6);
  });

  it('scales cable length by the published length', () => {
    const plain = makeData();
    const scaled = makeData(1107 * 1.3);
    const land = makeLand();
    const g1 = buildRouteGraph(plain, land);
    const r1 = routeTo(g1, shortestFrom(g1, 5, 5)!, plain.regions[1]);
    const g2 = buildRouteGraph(scaled, land);
    const r2 = routeTo(g2, shortestFrom(g2, 5, 5)!, scaled.regions[1]);
    const sub1 = r1!.segments.find((s) => s.kind === 'sub')!.km;
    const sub2 = r2!.segments.find((s) => s.kind === 'sub')!.km;
    // 没有官方长度时默认 ×1.15，有则按官方/绘制比例（上限 1.5）
    expect(sub2 / sub1).toBeCloseTo(1.3 / 1.15, 1);
  });

  it('returns null for clicks in the ocean', () => {
    const g = buildRouteGraph(makeData(), makeLand());
    expect(shortestFrom(g, 5, 15)).toBeNull();
  });

  it('falls back to great-circle × 1.5 when unreachable', () => {
    const data = makeData();
    const g = buildRouteGraph(data, makeLand());
    const rtt = estimateRtt(g, null, data.regions[1], 5, 5);
    const expected = (2 * haversineKm(5, 5, 5, 25) * 1.5) / FIBER_KM_PER_MS + ACCESS_RTT_MS;
    expect(rtt).toBeCloseTo(expected, 6);
  });

  it('reuses the temporary origin node across clicks', () => {
    const data = makeData();
    const g = buildRouteGraph(data, makeLand());
    shortestFrom(g, 5, 4);
    const n = g.nodes.length;
    shortestFrom(g, 6, 3);
    expect(g.nodes.length).toBe(n);
    const origin = g.index.get('origin')!;
    // 旧起点的边被清理，只剩新起点接入的边
    for (const e of g.adj[origin]) expect(e.km).toBeGreaterThan(0);
    expect(LAND_INFLATION).toBeGreaterThan(1);
  });

  it('puts a hop-to-hop leg across the sea on the cable and keeps overland legs direct', () => {
    const data = makeData();
    const g = buildRouteGraph(data, makeLand());
    const west = data.regions[0];
    const sp = shortestFrom(g, 5, 4)!;
    const before = routeTo(g, sp, west)!;

    const sea = pathBetween(g, { lat: 5, lng: 3 }, { lat: 5, lng: 27 });
    expect(sea.kind).toBe('sub');
    expect(sea.cables.map((c) => c.name)).toEqual(['Test Cable']);
    expect(sea.km).toBeGreaterThan(haversineKm(5, 3, 5, 27));
    const [first, last] = [sea.coords[0], sea.coords[sea.coords.length - 1]];
    expect([first[0], first[1], last[0], last[1]].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([3, 5, 27, 5]);

    const land = pathBetween(g, { lat: 2, lng: 1 }, { lat: 8, lng: 8 });
    expect(land.kind).toBe('land');
    expect(land.rttMs).toBeCloseTo((2 * haversineKm(2, 1, 8, 8) * LAND_INFLATION) / FIBER_KM_PER_MS, 5);

    // 计算中途接入的临时点不能影响点击起点已有的最短路结果
    expect(routeTo(g, sp, west)).toEqual(before);
    // 再算一次起点最短路也一样（临时点留下的空节点不可达）
    const again = shortestFrom(g, 5, 4)!;
    expect(Array.from(again.dist.slice(0, sp.dist.length))).toEqual(Array.from(sp.dist));
    expect(Array.from(again.dist.slice(sp.dist.length))).toEqual(Array(again.dist.length - sp.dist.length).fill(Infinity));
  });
});

