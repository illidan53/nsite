import { useEffect, useMemo, useState } from 'react';
import { locateIps, networksForIps, type IpLocation, type IpNetwork, type TraceResult } from '../lib/atlas.ts';
import { haversineKm } from '../lib/geo.ts';
import { useRouteGraph } from '../lib/graphContext.ts';
import { useI18n, type Translate } from '../lib/i18n.tsx';
import { FIBER_KM_PER_MS, pathBetween, type PhysicalLeg } from '../lib/routing.ts';
import { hopRange, type TraceOverlay } from './GlobeView.tsx';
import { fmtKm, fmtMs } from './RegionList.tsx';

export interface TraceSource {
  id: number;
  lat: number;
  lng: number;
}

interface Props {
  probe: TraceSource;
  trace: TraceResult;
  /** 目标位置；city 用于表格里显示推断出的城市。 */
  target: { lat: number; lng: number; label: string; city?: string };
  onOverlay: (overlay: TraceOverlay | null) => void;
}

interface Enriched {
  locations: Map<string, IpLocation | null>;
  networks: Map<string, IpNetwork>;
}

/**
 * 光速约束：RTT 为 r 毫秒的路由器，离探针不可能超过 r/2 × 光纤光速。
 * 违反这一点的定位（常见于 IP 地理库把骨干网地址标到公司注册地）不可信。
 */
function feasible(probe: TraceSource, loc: IpLocation, minRtt: number | null) {
  if (minRtt === null) return true;
  return haversineKm(probe.lat, probe.lng, loc.lat, loc.lng) <= (minRtt / 2) * FIBER_KM_PER_MS + 100;
}

/** RIPEstat 的 holder 形如 "CHINANET-BACKBONE - No.31,Jin-rong Street" 或 "AS272894 - MISTICOM ..."，取可读的名称部分。 */
function shortHolder(h: string | null) {
  if (!h) return '';
  const parts = h.split(' - ');
  const name = /^AS\d+$/i.test(parts[0].trim()) && parts[1] ? parts[1] : parts[0];
  return name.split(',')[0].trim().slice(0, 42);
}

/** 同一地点（这个距离内）的连续几跳在地球上合并成一个标记。 */
const SAME_PLACE_KM = 20;

/** 没有定位的跳：RTT 与前后最近的已定位跳相差不超过这个值时，认为在同一城市。 */
const inferTolerance = (rtt: number) => Math.max(2, rtt * 0.03);

interface Place {
  lat: number;
  lng: number;
  city: string;
  country: string | null;
  /** 按 RTT 推断的位置：参照的跳数，或探针本身。 */
  inferredFrom?: number | 'probe';
}

/** 地球上的一个地点：探针、若干合并在一起的跳，或目标。 */
interface Stop {
  lat: number;
  lng: number;
  kind: 'probe' | 'hop' | 'target';
  hops: number[];
  city: string;
  /** 这组里第一跳和最后一跳的 RTT（探针为 0，目标未知为 null）。 */
  firstRtt: number | null;
  lastRtt: number | null;
}

function legText(leg: PhysicalLeg, t: Translate) {
  const km = fmtKm(leg.km);
  if (leg.kind === 'sub') {
    const names = leg.cables.map((c) => c.name);
    return t('atlas.leg.sub', { cables: names.slice(0, 2).join(' / ') + (names.length > 2 ? ' …' : ''), km });
  }
  if (leg.kind === 'land') return t('atlas.leg.land', { km });
  if (leg.kind === 'unknown') return t('atlas.leg.unknown', { km });
  return '';
}

function fmtDelta(d: number) {
  if (Math.abs(d) < 0.05) return '0';
  return `${d > 0 ? '+' : ''}${fmtMs(d)}`;
}

/** 一条 traceroute 的逐跳表：补上每跳位置（IPmap）和归属网络（RIPEstat），并在地球上画出路径。 */
export default function TraceDetail({ probe, trace, target, onOverlay }: Props) {
  const { t } = useI18n();
  const graph = useRouteGraph();
  const [enriched, setEnriched] = useState<Enriched | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setEnriched(null);
    const ips = trace.hops.filter((h) => h.ip && !h.isPrivate).map((h) => h.ip!);
    Promise.all([locateIps(ips, ctrl.signal), networksForIps(ips, ctrl.signal)])
      .then(([locations, networks]) => setEnriched({ locations, networks }))
      .catch(() => {
        if (!ctrl.signal.aborted) setEnriched({ locations: new Map(), networks: new Map() });
      });
    return () => ctrl.abort();
  }, [trace]);

  const rows = useMemo(() => {
    const base = trace.hops.map((h) => {
      const loc = h.ip ? enriched?.locations.get(h.ip) ?? null : null;
      const net = h.ip ? enriched?.networks.get(h.ip) ?? null : null;
      const ok = loc ? feasible(probe, loc, h.minRtt) : false;
      let place: Place | null = loc && ok ? { lat: loc.lat, lng: loc.lng, city: loc.city, country: loc.country } : null;
      // 目标自己的地址没有定位时，用已知的目标位置
      if (!place && h.ip && h.ip === trace.dstAddr) place = { lat: target.lat, lng: target.lng, city: target.city ?? target.label, country: null };
      return { h, loc, ok, net, place };
    });
    // 没有定位（或是内网地址）但有应答的跳：RTT 与前后最近的已定位跳（探针算 0 ms）几乎一样时，认为在同一城市
    if (enriched) {
      const known = [
        { i: -1, rtt: 0, place: { lat: probe.lat, lng: probe.lng, city: '', country: null } as Place, from: 'probe' as const },
        ...base.flatMap((r, i) => (r.place && r.h.minRtt !== null ? [{ i, rtt: r.h.minRtt, place: r.place, from: r.h.hop }] : [])),
      ];
      base.forEach((r, i) => {
        if (r.place || r.h.minRtt === null || !r.h.ip) return;
        const rtt = r.h.minRtt;
        const prev = known.filter((k) => k.i < i).at(-1);
        const next = known.find((k) => k.i > i);
        const best = [prev, next]
          .filter((k): k is (typeof known)[number] => Boolean(k) && Math.abs(rtt - k!.rtt) <= inferTolerance(rtt))
          .sort((a, b) => Math.abs(rtt - a.rtt) - Math.abs(rtt - b.rtt))[0];
        if (best) r.place = { ...best.place, inferredFrom: best.from };
      });
    }
    let prevRtt: number | null = null;
    return base.map((r) => {
      const delta = r.h.minRtt !== null && prevRtt !== null ? r.h.minRtt - prevRtt : null;
      if (r.h.minRtt !== null) prevRtt = r.h.minRtt;
      return { ...r, delta };
    });
  }, [probe, trace, target, enriched]);

  // 地球上的地点：探针 → 各跳（同一地点的连续跳合并）→ 目标
  const stops = useMemo(() => {
    const list: Stop[] = [{ lat: probe.lat, lng: probe.lng, kind: 'probe', hops: [], city: '', firstRtt: 0, lastRtt: 0 }];
    for (const { h, place } of rows) {
      if (!place) continue;
      const last = list[list.length - 1];
      if (haversineKm(last.lat, last.lng, place.lat, place.lng) < SAME_PLACE_KM) {
        last.hops.push(h.hop);
        if (h.minRtt !== null) last.lastRtt = h.minRtt;
        continue;
      }
      list.push({ lat: place.lat, lng: place.lng, kind: 'hop', hops: [h.hop], city: place.city, firstRtt: h.minRtt, lastRtt: h.minRtt });
    }
    const last = list[list.length - 1];
    if (list.length === 1 || haversineKm(last.lat, last.lng, target.lat, target.lng) >= SAME_PLACE_KM) {
      list.push({ lat: target.lat, lng: target.lng, kind: 'target', hops: [], city: target.label, firstRtt: null, lastRtt: null });
    }
    return list;
  }, [rows, probe, target]);

  // 相邻两个地点之间推测的物理路径：陆路直连，或按海缆 + 陆地图找最短路径
  const legs = useMemo(
    () =>
      stops.slice(1).map((to, i) => {
        const from = stops[i];
        const leg = graph ? pathBetween(graph, from, to) : null;
        const delta = to.firstRtt !== null && from.lastRtt !== null ? to.firstRtt - from.lastRtt : null;
        return { from, to, leg, delta };
      }),
    [stops, graph],
  );
  /** 每段路径从哪一跳开始（该跳所在行下面显示这段是陆路还是海缆）。 */
  const legByHop = useMemo(() => new Map(legs.filter((l) => l.to.hops.length).map((l) => [l.to.hops[0], l])), [legs]);

  useEffect(() => {
    const label = (s: Stop) =>
      s.kind === 'probe'
        ? s.hops.length
          ? t('marker.probeHops', { id: probe.id, hops: hopRange(s.hops) })
          : t('marker.probe', { id: probe.id })
        : s.kind === 'target'
          ? target.label
          : t(s.hops.length > 1 ? 'marker.hops' : 'marker.hop', { hops: hopRange(s.hops), city: s.city });
    onOverlay({
      points: stops.map((s) => ({ lat: s.lat, lng: s.lng, kind: s.kind, hops: s.hops, label: label(s) })),
      legs: legs.flatMap(({ from, to, leg }) => {
        if (!leg) return [];
        const text = legText(leg, t);
        return [{ coords: leg.coords, kind: leg.kind, label: `${label(from)} → ${label(to)}${text ? ` · ${text}` : ''}` }];
      }),
    });
  }, [stops, legs, probe.id, target.label, onOverlay, t]);

  useEffect(() => () => onOverlay(null), [onOverlay]);

  return (
    <>
      {!trace.reached && <p className="muted">{t('atlas.unreached')}</p>}
      <table className="hops">
        <thead>
          <tr>
            <th>{t('atlas.colHop')}</th>
            <th>{t('atlas.colRouter')}</th>
            <th>{t('atlas.colLoc')}</th>
            <th className="num">RTT</th>
            <th className="num">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ h, loc, ok, net, place, delta }) => {
            const leg = legByHop.get(h.hop);
            const legLine = leg?.leg && leg.leg.kind !== 'direct' ? legText(leg.leg, t) : '';
            return (
              <tr key={h.hop} className={h.ip ? '' : 'timeout'}>
                <td>{h.hop}</td>
                <td>
                  {h.ip ? <span className="mono">{h.ip}</span> : <span className="muted">* * *</span>}
                  {h.isPrivate && <span className="muted"> {t('atlas.private')}</span>}
                  {net?.asn && (
                    <div className="hop-net">
                      AS{net.asn} {shortHolder(net.holder)}
                    </div>
                  )}
                </td>
                <td>
                  {place?.inferredFrom !== undefined ? (
                    <span
                      className="loc-inferred"
                      title={place.inferredFrom === 'probe' ? t('atlas.inferredProbe') : t('atlas.inferred', { hop: place.inferredFrom })}
                    >
                      ≈ {place.inferredFrom === 'probe' ? t('atlas.nearProbe') : `${place.city}${place.country ? `, ${place.country}` : ''}`}
                    </span>
                  ) : loc ? (
                    <span className={ok ? '' : 'loc-bad'} title={ok ? undefined : t('atlas.badLoc')}>
                      {loc.city}
                      {loc.country ? `, ${loc.country}` : ''}
                    </span>
                  ) : place ? (
                    <span>{place.city}</span>
                  ) : h.ip && !h.isPrivate && !enriched ? (
                    '…'
                  ) : (
                    '—'
                  )}
                  {legLine && (
                    <div
                      className={`hop-leg hop-leg-${leg!.leg!.kind}`}
                      title={leg!.delta !== null ? t('atlas.legTitle', { delta: fmtMs(leg!.delta), floor: fmtMs(leg!.leg!.rttMs) }) : t('atlas.legTitleNoDelta')}
                    >
                      ↳ {legLine}
                    </div>
                  )}
                </td>
                <td className="num">{h.minRtt !== null ? fmtMs(h.minRtt) : ''}</td>
                <td className={`num ${delta !== null && delta > 15 ? 'jump' : ''}`}>{delta !== null ? fmtDelta(delta) : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">{t('atlas.footnote')}</p>
    </>
  );
}
