import { describe, expect, it } from 'vitest';
import { BORROW_MAX_KM, bestRtt, fasterThanLight, measuredOriginFor, measuredOriginsFor, mineFor, type MeasuredOrigin } from './measured.ts';
import type { Place } from './places.ts';
import type { MeasuredData, Region } from './types.ts';

const cell = (country: string, lat: number, lng: number) => ({ country, lat, lng, regions: {} });
const data: MeasuredData = {
  generatedAt: '2026-09-28T00:00:00Z',
  runs: [],
  probes: {},
  cells: { 'US-NJ': cell('US', 40.2, -74.6), 'US-CA': cell('US', 37, -120), DE: cell('DE', 51, 10) },
};

function place(iso2: string, admin1Iso?: string): Place {
  return {
    country: { name: iso2, nameZh: iso2, iso2, iso3: '', continent: '', pop: null, popYear: null },
    admin1: admin1Iso
      ? { name: admin1Iso, nameZh: null, iso: admin1Iso, adm0: '', type: null, labelLat: null, labelLng: null, area: null, pop: null, popYear: null }
      : null,
  } as Place;
}

describe('measuredOriginFor', () => {
  it('uses the clicked province when it was measured', () => {
    expect(measuredOriginFor(data, place('US', 'US-NJ'), { lat: 40, lng: -74 })).toMatchObject({ id: 'US-NJ', kind: 'own', tooFar: false });
  });

  it('falls back to the country cell, with its distance', () => {
    const o = measuredOriginFor(data, place('DE', 'DE-BY'), { lat: 48, lng: 11 });
    expect(o).toMatchObject({ id: 'DE', kind: 'country', tooFar: false });
    expect(o!.km).toBeGreaterThan(300);
    expect(o!.km).toBeLessThan(400);
  });

  it('borrows the nearest measured province of the same country', () => {
    expect(measuredOriginFor(data, place('US', 'US-PA'), { lat: 40.5, lng: -77 })).toMatchObject({ id: 'US-NJ', kind: 'near', tooFar: false });
    // 点在省界外（没有 admin1）时也一样
    expect(measuredOriginFor(data, place('US'), { lat: 40.5, lng: -77 })).toMatchObject({ id: 'US-NJ', kind: 'near' });
  });

  it('keeps the country cell as a fallback when every measured province is too far', () => {
    const both: MeasuredData = { ...data, cells: { ...data.cells, US: cell('US', 38.6, -90.2) } };
    // 宾州离新泽西近：用省
    expect(measuredOriginFor(both, place('US', 'US-PA'), { lat: 40.5, lng: -77 })).toMatchObject({ id: 'US-NJ', kind: 'near' });
    // 密苏里离两个已测省都超过 500 km：用按全国测的数据（就在附近）
    expect(measuredOriginFor(both, place('US', 'US-MO'), { lat: 38.6, lng: -90.2 })).toMatchObject({ id: 'US', kind: 'country', tooFar: false });
  });

  it('marks a borrowed area beyond the distance cap as too far', () => {
    const o = measuredOriginFor(data, place('US', 'US-TX'), { lat: 31, lng: -100 });
    expect(o).toMatchObject({ id: 'US-CA', kind: 'near', tooFar: true });
    expect(o!.km).toBeGreaterThan(BORROW_MAX_KM);
  });

  it('ignores a province cell that belongs to another country', () => {
    const pr: MeasuredData = { ...data, cells: { 'US-PR': cell('US', 18.3, -64.9), PR: cell('PR', 18.4, -66.1) } };
    expect(measuredOriginFor(pr, place('PR', 'US-PR'), { lat: 18.4, lng: -66.1 })).toMatchObject({ id: 'PR', kind: 'country' });
  });

  it('maps French overseas departments to their own cells', () => {
    const fr: MeasuredData = { ...data, cells: { FR: cell('FR', 48.8, 2.3), RE: cell('RE', -21.1, 55.5) } };
    expect(measuredOriginFor(fr, place('FR', 'FR-RE'), { lat: -21.1, lng: 55.5 })).toMatchObject({ id: 'RE', kind: 'own' });
    expect(measuredOriginFor(fr, place('FR', 'FR-MQ'), { lat: 14.6, lng: -61 })).toBeNull();
    expect(measuredOriginFor(fr, place('FR', 'FR-IDF'), { lat: 48.8, lng: 2.3 })).toMatchObject({ id: 'FR', kind: 'country' });
  });

  it('maps places without an ISO2 code (N. Cyprus) to their own code', () => {
    const cy: MeasuredData = { ...data, cells: { XN: cell('XN', 35.2, 33.4), CY: cell('CY', 34.9, 33.6) } };
    const nCyprus = { country: { name: 'N. Cyprus', nameZh: null, iso2: '-99', iso3: 'CYN', continent: '', pop: null, popYear: null }, admin1: null } as unknown as Place;
    expect(measuredOriginFor(cy, nCyprus, { lat: 35.2, lng: 33.4 })).toMatchObject({ id: 'XN', kind: 'country' });
  });

  it('returns null for countries without measurements', () => {
    expect(measuredOriginFor(data, place('FR', 'FR-IDF'), { lat: 48.8, lng: 2.3 })).toBeNull();
  });
});

describe('mineFor', () => {
  const region = { id: 'aws:x', lat: 40.7, lng: -74 } as Region;
  type R = { probe: number; rtt: number | null; bad?: true };
  const at = (id: string, km: number, results: R[] | null, probeKm: Record<number, number> = {}): MeasuredOrigin => ({
    id,
    kind: km ? 'near' : 'own',
    km,
    probeKm,
    tooFar: false,
    cell: { ...cell('US', 40.2, -74.6), regions: results ? { 'aws:x': { run: 0, msm: 1, target: 'x', at: 0, results } } : {} },
  });
  const here = { lat: 40.5, lng: -74.2 };

  it('returns the lowest reached RTT and where it came from', () => {
    const r = mineFor([at('US-NJ', 0, [{ probe: 1, rtt: 9 }, { probe: 2, rtt: null }])], region, here);
    expect(r).toMatchObject({ ms: 9, unreached: false, origin: { id: 'US-NJ' } });
  });

  it('tells "measured but unreachable" apart from "not measured"', () => {
    expect(mineFor([at('US-NJ', 0, [{ probe: 1, rtt: null }])], region, here)).toMatchObject({ ms: null, unreached: true });
    expect(mineFor([at('US-NJ', 0, null)], region, here)).toMatchObject({ ms: null, unreached: false, origin: null });
  });

  it('does not call a data center unreachable because of probes that fail everything', () => {
    expect(mineFor([at('US-NJ', 0, [{ probe: 1, rtt: null, bad: true }])], region, here)).toMatchObject({ unreached: false });
    // 借来的地区要 2 个好探针都没到达才算不通
    expect(mineFor([at('US-NY', 100, [{ probe: 1, rtt: null }], { 1: 100 })], region, here)).toMatchObject({ unreached: false });
    expect(mineFor([at('US-NY', 100, [{ probe: 1, rtt: null }, { probe: 2, rtt: null }], { 1: 100, 2: 120 })], region, here)).toMatchObject({ unreached: true });
  });

  it('takes each data center from the nearest area that measured it', () => {
    // 自己省没测这个数据中心、邻省测了：用邻省
    expect(mineFor([at('US-NJ', 0, null), at('US-NY', 150, [{ probe: 3, rtt: 7 }], { 3: 150 })], region, here)).toMatchObject({ ms: 7, origin: { id: 'US-NY' } });
    // 近的那个测了但不通、远一点的到达了：用到达的值
    expect(mineFor([at('US-NJ', 0, [{ probe: 1, rtt: null }]), at('US', 300, [{ probe: 4, rtt: 12 }], { 4: 300 })], region, here)).toMatchObject({ ms: 12, origin: { id: 'US' } });
  });

  it('ignores a borrowed value whose probe is beyond the distance cap', () => {
    expect(mineFor([at('US-NY', 300, [{ probe: 3, rtt: 7 }], { 3: 650 })], region, here)).toMatchObject({ ms: null, origin: null });
  });

  it('drops only the faster-than-light results, keeping the rest of the same area', () => {
    // 点击处离数据中心约 1,100 km（极限约 10 ms）：2 ms 去掉，20 ms 留下
    expect(mineFor([at('US-NJ', 0, [{ probe: 1, rtt: 2 }, { probe: 2, rtt: 20 }])], region, { lat: 41, lng: -87 })).toMatchObject({ ms: 20 });
    expect(mineFor([at('US-NJ', 0, [{ probe: 1, rtt: 2 }])], region, { lat: 41, lng: -87 })).toMatchObject({ ms: null, unreached: false });
  });

  it('uses only a small slack for the exact click point', () => {
    // 点击处离数据中心 264 km：1.2 ms 不可能（极限约 2.1 ms）
    expect(mineFor([at('US-NJ', 0, [{ probe: 1, rtt: 1.2 }])], region, { lat: 38.32, lng: -74.6 })).toMatchObject({ ms: null });
  });
});

describe('measuredOriginsFor', () => {
  it('lists the own province first, then nearby areas within the cap, and drops far ones', () => {
    const d: MeasuredData = { ...data, cells: { ...data.cells, 'US-NY': cell('US', 43, -75), US: cell('US', 38.6, -90.2) } };
    const { usable, nearest } = measuredOriginsFor(d, place('US', 'US-NJ'), { lat: 40, lng: -74.5 });
    expect(usable.map((o) => o.id)).toEqual(['US-NJ', 'US-NY']);
    expect(nearest).toMatchObject({ id: 'US-NJ', kind: 'own' });
  });
});

describe('fasterThanLight', () => {
  it('flags replies faster than light in fiber, with slack for city-level coordinates', () => {
    // 北京 → 首尔约 950 km：0.9 ms 不可能，35 ms 正常
    expect(fasterThanLight(0.9, 950)).toBe(true);
    expect(fasterThanLight(35, 950)).toBe(false);
    // 同城或 200 km 以内不判断
    expect(fasterThanLight(0.1, 150)).toBe(false);
  });
});

describe('bestRtt', () => {
  it('takes the lowest RTT of probes that reached the target', () => {
    expect(bestRtt({ run: 0, msm: 1, target: 'x', at: 0, results: [{ probe: 1, rtt: 12.3 }, { probe: 2, rtt: null }, { probe: 3, rtt: 9.1 }] })).toBe(9.1);
    expect(bestRtt({ run: 0, msm: 1, target: 'x', at: 0, results: [{ probe: 1, rtt: null }] })).toBeNull();
    expect(bestRtt(undefined)).toBeNull();
  });
});
