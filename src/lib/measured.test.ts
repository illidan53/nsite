import { describe, expect, it } from 'vitest';
import { bestRtt, measuredOriginFor } from './measured.ts';
import type { Place } from './places.ts';
import type { MeasuredData } from './types.ts';

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
    expect(measuredOriginFor(data, place('US', 'US-NJ'), { lat: 40, lng: -74 })).toMatchObject({ id: 'US-NJ', exact: true });
  });

  it('falls back to the country cell', () => {
    expect(measuredOriginFor(data, place('DE', 'DE-BY'), { lat: 48, lng: 11 })).toMatchObject({ id: 'DE', exact: true });
  });

  it('falls back to the nearest measured province of the same country', () => {
    expect(measuredOriginFor(data, place('US', 'US-PA'), { lat: 40.5, lng: -77 })).toMatchObject({ id: 'US-NJ', exact: false });
  });

  it('returns null for countries without measurements', () => {
    expect(measuredOriginFor(data, place('FR', 'FR-IDF'), { lat: 48.8, lng: 2.3 })).toBeNull();
  });
});

describe('bestRtt', () => {
  it('takes the lowest RTT of probes that reached the target', () => {
    expect(bestRtt({ run: 0, msm: 1, target: 'x', at: 0, results: [{ probe: 1, rtt: 12.3 }, { probe: 2, rtt: null }, { probe: 3, rtt: 9.1 }] })).toBe(9.1);
    expect(bestRtt({ run: 0, msm: 1, target: 'x', at: 0, results: [{ probe: 1, rtt: null }] })).toBeNull();
    expect(bestRtt(undefined)).toBeNull();
  });
});
