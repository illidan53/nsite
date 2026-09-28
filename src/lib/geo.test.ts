import { describe, expect, it } from 'vitest';
import { LandMask, greatCirclePoints, haversineKm, interpolateGreatCircle } from './geo.ts';

describe('haversineKm', () => {
  it('matches known city distances', () => {
    // 上海 — 东京 约 1,760 km；伦敦 — 纽约 约 5,570 km
    expect(haversineKm(31.23, 121.47, 35.68, 139.69)).toBeGreaterThan(1740);
    expect(haversineKm(31.23, 121.47, 35.68, 139.69)).toBeLessThan(1780);
    expect(haversineKm(51.507, -0.128, 40.713, -74.006)).toBeGreaterThan(5550);
    expect(haversineKm(51.507, -0.128, 40.713, -74.006)).toBeLessThan(5590);
  });

  it('handles the antimeridian', () => {
    expect(haversineKm(0, 179.5, 0, -179.5)).toBeCloseTo(111.2, 0);
  });
});

describe('great circle helpers', () => {
  it('interpolates endpoints exactly', () => {
    const a: [number, number] = [121.47, 31.23];
    const b: [number, number] = [139.69, 35.68];
    expect(interpolateGreatCircle(a, b, 0)[0]).toBeCloseTo(a[0], 6);
    expect(interpolateGreatCircle(a, b, 1)[1]).toBeCloseTo(b[1], 6);
  });

  it('samples at roughly the requested step', () => {
    const pts = greatCirclePoints([0, 0], [10, 0], 100);
    expect(pts.length).toBe(13); // 1112 km / 100 km → 12 段
  });
});

describe('LandMask', () => {
  // 一块 10°×10° 的“大陆”：lng 0..10, lat 0..10
  const mask = new LandMask();
  for (let row = 80 * LandMask.RES; row < 90 * LandMask.RES; row++) {
    for (let col = 180 * LandMask.RES; col < 190 * LandMask.RES; col++) mask.set(row, col);
  }

  it('looks up cells', () => {
    expect(mask.isLand(5, 5)).toBe(true);
    expect(mask.isLand(-5, 5)).toBe(false);
    expect(mask.isLand(5, -5)).toBe(false);
  });

  it('accepts paths over land and rejects ocean crossings', () => {
    expect(mask.overlandPath([1, 1], [9, 9])).toBe(true);
    expect(mask.overlandPath([1, 5], [30, 5])).toBe(false);
  });

  it('tolerates coastal endpoints within the slack', () => {
    // 终点在海岸外约 10 km
    expect(mask.overlandPath([5, 5], [10.09, 5], 25)).toBe(true);
    expect(mask.nearLand(10.2, 5, 30)).toBe(true);
    expect(mask.nearLand(15, 5, 30)).toBe(false);
  });
});
