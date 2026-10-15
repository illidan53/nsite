import { describe, expect, it } from 'vitest';
import { chooseProbes, failedProbes, nearestTargets, pairKey, plan, planCost, planPairs, silentProbes, type BatchCell, type BatchProbe, type BatchTarget } from './batch-plan.ts';

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

  it('skips excluded probes', () => {
    expect(chooseProbes(cell, 2, [], [1]).map((p) => p.id)).toEqual([2, 3]);
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

  it('skips pairs that were already measured', () => {
    const ms = plan(cells, targets, { nearest: 1, probes: 2, skip: new Set([pairKey('US-NJ', 'aws:us-east-1'), pairKey('IE', 'gcp:europe-west1')]) });
    expect(ms.map((m) => m.target.region).sort()).toEqual(['aws:eu-west-1', 'gcp:us-east4']);
    expect(planCost(ms).results).toBe(3);
  });

  it('excludes failed probes only for the protocol they failed on', () => {
    const mixed = [target('aws:us-east-1', 'aws', 38.9, -77.4), { ...target('tencent:na-ashburn', 'tencent', 39, -77.5), protocol: 'ICMP' as const }];
    const ms = plan([cells[0]], mixed, { nearest: 1, probes: 1, excludeProbes: { TCP: [1] } });
    expect(Object.fromEntries(ms.map((m) => [m.target.region, m.probes.map((p) => p.probe.id)]))).toEqual({
      'aws:us-east-1': [3],
      'tencent:na-ashburn': [1],
    });
  });
});

describe('failedProbes', () => {
  it('flags probes that never reached a target over one protocol', () => {
    const r = (probe: number, protocol: 'ICMP' | 'TCP', rtt: number | null) => ({ probe, protocol, rtt });
    expect(
      failedProbes([
        // 1：TCP 全部失败，ICMP 正常
        r(1, 'TCP', null), r(1, 'TCP', null), r(1, 'ICMP', 20),
        // 2：TCP 只失败一次
        r(2, 'TCP', null), r(2, 'TCP', 30),
        // 3：只测过一次，失败
        r(3, 'ICMP', null),
        // 4：TCP 全部失败，ICMP 只测过一次
        r(4, 'TCP', null), r(4, 'TCP', null), r(4, 'ICMP', null),
        // 5：ICMP 全部失败
        r(5, 'ICMP', null), r(5, 'ICMP', null), r(5, 'TCP', 12),
      ]),
    ).toEqual({ TCP: [1, 4], ICMP: [5] });
  });
});

describe('silentProbes', () => {
  it('flags probes scheduled at least twice that never returned a result', () => {
    expect(silentProbes([1, 1, 2, 3, 3, 3], new Set([3]))).toEqual([1]);
  });
});

describe('planPairs', () => {
  const targets = [target('aws:us-east-1', 'aws', 38.9, -77.4), target('aws:eu-west-1', 'aws', 53.3, -6.3)];
  const cells: BatchCell[] = [
    { id: 'US-NJ', country: 'US', lat: 40.7, lng: -74, probes: [probe(1, 701, 40.7, -74), probe(3, 7922, 41, -74.5), probe(5, 3356, 40.6, -74.1)] },
  ];

  it('measures only the listed pairs and skips probes already used for that pair', () => {
    const { planned, skipped } = planPairs(
      cells,
      targets,
      [
        { cell: 'US-NJ', region: 'aws:eu-west-1', probes: 2 },
        { cell: 'US-NJ', region: 'aws:us-east-1', probes: 1 },
        { cell: 'XX', region: 'aws:us-east-1', probes: 1 },
      ],
      { used: new Map([[pairKey('US-NJ', 'aws:us-east-1'), [1]]]) },
    );
    const byRegion = Object.fromEntries(planned.map((m) => [m.target.region, m.probes.map((p) => p.probe.id)]));
    expect(byRegion).toEqual({ 'aws:eu-west-1': [1, 5], 'aws:us-east-1': [5] });
    expect(skipped).toEqual([{ cell: 'XX', region: 'aws:us-east-1', probes: 1, why: 'no cell' }]);
  });
});
