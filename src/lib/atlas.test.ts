import { describe, expect, it } from 'vitest';
import { isPrivateIp, parseTraceroute } from './atlas.ts';

describe('isPrivateIp', () => {
  it('detects RFC1918, CGNAT and link-local ranges', () => {
    for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '100.64.0.1', '100.127.1.1', '169.254.169.254', '127.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '129.250.5.201']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe('parseTraceroute', () => {
  const raw = {
    msm_id: 1,
    prb_id: 7172,
    timestamp: 1790560098,
    from: '63.222.106.8',
    src_addr: '63.222.106.8',
    dst_addr: '104.238.161.230',
    destination_ip_responded: true,
    result: [
      { hop: 1, result: [{ from: '63.222.106.2', rtt: 0.826 }, { from: '63.222.106.2', rtt: 0.638 }, { from: '63.222.106.2', rtt: 0.7 }] },
      { hop: 2, result: [{ x: '*' }, { x: '*' }, { x: '*' }] },
      // 负载均衡：同一跳两个地址，取出现次数多的那个
      { hop: 3, result: [{ from: '1.1.1.1', rtt: 30 }, { from: '2.2.2.2', rtt: 20 }, { from: '1.1.1.1', rtt: 31 }] },
      { hop: 4, result: [{ from: '104.238.161.230', rtt: 31.1 }] },
    ],
  };

  it('picks the dominant responder and its min RTT', () => {
    const t = parseTraceroute(raw);
    expect(t.hops[0]).toMatchObject({ hop: 1, ip: '63.222.106.2', minRtt: 0.638, sent: 3 });
    expect(t.hops[1]).toMatchObject({ hop: 2, ip: null, minRtt: null });
    expect(t.hops[2]).toMatchObject({ ip: '1.1.1.1', minRtt: 30 });
    expect(t.reached).toBe(true);
    expect(t.probeId).toBe(7172);
  });

  it('infers reachability when the flag is missing', () => {
    const t = parseTraceroute({ ...raw, destination_ip_responded: undefined });
    expect(t.reached).toBe(true);
    const t2 = parseTraceroute({ ...raw, destination_ip_responded: undefined, result: raw.result.slice(0, 3) });
    expect(t2.reached).toBe(false);
  });
});

describe('parseTraceroute (TCP)', () => {
  it('renumbers the destination reply recorded as hop 255', () => {
    const t = parseTraceroute({
      msm_id: 2,
      prb_id: 1,
      timestamp: 0,
      from: '1.1.1.1',
      src_addr: '1.1.1.1',
      dst_addr: '98.87.175.205',
      destination_ip_responded: true,
      result: [
        { hop: 1, result: [{ from: '10.0.0.1', rtt: 1 }] },
        { hop: 2, result: [{ x: '*' }] },
        { hop: 255, result: [{ from: '98.87.175.205', rtt: 11 }] },
      ],
    });
    expect(t.hops.map((h) => h.hop)).toEqual([1, 2, 3]);
    expect(t.hops[2].ip).toBe('98.87.175.205');
  });
});

