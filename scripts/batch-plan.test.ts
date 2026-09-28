import { describe, expect, it } from 'vitest';
import { chooseProbes, nearestTargets, plan, planCost, type BatchCell, type BatchProbe, type BatchTarget } from './batch-plan.ts';

const probe = (id: number, asn: number, lat: number, lng: number, stable = true): BatchProbe => ({ id, asn, lat, lng, cc: 'US', stable });
const target = (region: string, provider: string, lat: number, lng: number): BatchTarget => ({
  region,
  provider,
  host: `${region}.example`,
  protocol: 'TCP',
  lat,
  lng,
});

describe('chooseProbes', () => {
  const cell: BatchCell = {
    id: 'US-NJ',
    country: 'US',
    lat: 40.7,
    lng: -74,
    probes: [probe(1, 701, 40.7, -74), probe(2, 701, 40.71, -74), probe(3, 7922, 41, -74.5), probe(4, 3356, 40.7, -74, false)],
  };

  it('prefers stable probes and different ASNs', () => {
    expect(chooseProbes(cell, 2).map((p) => p.id)).toEqual([1, 3]);
  });

  it('skips probes inside excluded networks', () => {
    expect(chooseProbes(cell, 2, [701]).map((p) => p.id)).toEqual([3, 4]);
  });

  it('fills with same-ASN probes when there are too few networks', () => {
    expect(chooseProbes({ ...cell, probes: cell.probes.slice(0, 2) }, 2).map((p) => p.id)).toEqual([1, 2]);
  });
});

describe('plan', () => {
  const targets = [
    target('aws:us-east-1', 'aws', 38.9, -77.4),
    target('aws:eu-west-1', 'aws', 53.3, -6.3),
    target('gcp:us-east4', 'gcp', 39, -77.5),
    target('gcp:europe-west1', 'gcp', 50.4, 3.8),
  ];
  const cells: BatchCell[] = [
    { id: 'US-NJ', country: 'US', lat: 40.7, lng: -74, probes: [probe(1, 701, 40.7, -74), probe(3, 7922, 41, -74.5)] },
    { id: 'IE', country: 'IE', lat: 53.3, lng: -6.3, probes: [probe(9, 5466, 53.3, -6.3)] },
  ];

  it('takes the nearest regions of each provider', () => {
    expect(nearestTargets(cells[0], targets, 1).map((t) => t.region)).toEqual(['aws:us-east-1', 'gcp:us-east4']);
  });

  it('groups probes by target and counts credits', () => {
    const ms = plan(cells, targets, { nearest: 1, probes: 2 });
    const byRegion = Object.fromEntries(ms.map((m) => [m.target.region, m.probes.map((p) => `${p.cell}#${p.probe.id}`)]));
    expect(byRegion).toEqual({
      'aws:us-east-1': ['US-NJ#1', 'US-NJ#3'],
      'gcp:us-east4': ['US-NJ#1', 'US-NJ#3'],
      'aws:eu-west-1': ['IE#9'],
      'gcp:europe-west1': ['IE#9'],
    });
    expect(planCost(ms)).toEqual({ measurements: 4, results: 6, credits: 360 });
  });

  it('measures every region with nearest = all', () => {
    expect(planCost(plan(cells, targets, { nearest: 'all', probes: 1 })).results).toBe(8);
  });
});
