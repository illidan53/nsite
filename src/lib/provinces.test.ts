import { describe, expect, it } from 'vitest';
import { expandedCountries, pixelSize, visibleRadius, type CountryMetric } from './provinces.ts';

// 用等面积直径近似：美国约 0.55 rad，德国约 0.106 rad，比利时约 0.031 rad
const metrics: CountryMetric[] = [
  { iso3: 'USA', lng: -98.5, lat: 39.5, diamRad: 0.55 },
  { iso3: 'DEU', lng: 10.4, lat: 51.1, diamRad: 0.106 },
  { iso3: 'BEL', lng: 4.6, lat: 50.6, diamRad: 0.031 },
];
const H = 900;

describe('pixelSize / visibleRadius', () => {
  it('shrinks with altitude and matches the horizon geometry', () => {
    expect(pixelSize(0.1, 1, H)).toBeCloseTo(2 * pixelSize(0.1, 2, H), 6);
    expect(visibleRadius(1)).toBeCloseTo(Math.PI / 3, 6); // 离地一个半径时地平线在 60°
  });
});

describe('expandedCountries', () => {
  it('expands big countries earlier than small ones', () => {
    expect(expandedCountries(metrics, { lat: 39, lng: -98, altitude: 2.5 }, H)).toEqual([]);
    expect(expandedCountries(metrics, { lat: 39, lng: -98, altitude: 1.7 }, H)).toEqual(['USA']);
    // 欧洲：德国在 0.35 左右展开，比利时要拉到 0.1 左右
    expect(expandedCountries(metrics, { lat: 51, lng: 8, altitude: 0.35 }, H)).toEqual(['DEU']);
    expect(expandedCountries(metrics, { lat: 50.7, lng: 4.8, altitude: 0.09 }, H)).toContain('BEL');
  });

  it('ignores countries near the horizon', () => {
    // 看着欧洲时，美国即使很大也在地平线附近，不展开
    expect(expandedCountries(metrics, { lat: 50, lng: 10, altitude: 1.2 }, H)).not.toContain('USA');
  });
});
