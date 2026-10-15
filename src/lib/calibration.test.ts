import { describe, expect, it } from 'vitest';
import { RTT_CALIBRATION, calibratedRtt } from './calibration.ts';

describe('calibratedRtt', () => {
  it('同城：只有接入 4 ms 的模型 → 5.92 ms', () => {
    expect(calibratedRtt(4, { originCountry: 'DE', regionCountry: 'DE' })).toBeCloseTo(5.92, 6);
  });
  it('同大洲常见距离：20 ms → 29.6 ms', () => {
    expect(calibratedRtt(20, { originCountry: 'FR', regionCountry: 'DE' })).toBeCloseTo(29.6, 6);
  });
  it('跨洲长距离：250 ms → 370 ms', () => {
    expect(calibratedRtt(250, { originCountry: 'AR', regionCountry: 'NZ' })).toBeCloseTo(370, 6);
  });
  it('不可达退化值（大圆 × 1.5）同样乘 k：127.8 → 189.144', () => {
    expect(calibratedRtt(127.8, { originCountry: 'TR', regionCountry: 'US' })).toBeCloseTo(189.144, 6);
  });
  it('进入中国大陆：固定 +168 ms（含港台）', () => {
    expect(calibratedRtt(30, { originCountry: 'JP', regionCountry: 'CN' })).toBe(198);
    expect(calibratedRtt(10, { originCountry: 'HK', regionCountry: 'CN' })).toBe(178);
    // 起点国家未知（如国界缝隙、海上）：不加跨境项，只乘 k
    expect(calibratedRtt(100, { originCountry: null, regionCountry: 'CN' })).toBeCloseTo(148, 6);
  });
  it('从中国大陆出境：固定 +72 ms；到香港也算出境', () => {
    expect(calibratedRtt(30, { originCountry: 'CN', regionCountry: 'JP' })).toBe(102);
    expect(calibratedRtt(8, { originCountry: 'CN', regionCountry: 'HK' })).toBe(80);
  });
  it('中国大陆境内：按 k 计，20 ms → 29.6 ms', () => {
    expect(calibratedRtt(20, { originCountry: 'CN', regionCountry: 'CN' })).toBeCloseTo(29.6, 6);
  });
  it('每组内单调不减，且从不低于模型（物理下限 + 接入）', () => {
    const groups = [
      { originCountry: 'DE', regionCountry: 'US' },
      { originCountry: 'JP', regionCountry: 'CN' },
      { originCountry: 'CN', regionCountry: 'SG' },
      { originCountry: 'CN', regionCountry: 'CN' },
      { originCountry: undefined, regionCountry: 'BR' },
    ];
    for (const f of groups) {
      let prev = -Infinity;
      for (let m = 4; m <= 400; m += 0.5) {
        const v = calibratedRtt(m, f);
        expect(v).toBeGreaterThanOrEqual(m);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
    expect(RTT_CALIBRATION.k).toBeGreaterThanOrEqual(1);
  });
});
