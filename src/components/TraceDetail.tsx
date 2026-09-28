import { useEffect, useMemo, useState } from 'react';
import { locateIps, networksForIps, type IpLocation, type IpNetwork, type TraceResult } from '../lib/atlas.ts';
import { haversineKm } from '../lib/geo.ts';
import { useI18n } from '../lib/i18n.tsx';
import { FIBER_KM_PER_MS } from '../lib/routing.ts';
import type { TraceOverlay } from './GlobeView.tsx';
import { fmtKm, fmtMs } from './RegionList.tsx';

export interface TraceSource {
  id: number;
  lat: number;
  lng: number;
}

interface Props {
  probe: TraceSource;
  trace: TraceResult;
  target: { lat: number; lng: number; label: string };
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

function fmtDelta(d: number) {
  if (Math.abs(d) < 0.05) return '0';
  return `${d > 0 ? '+' : ''}${fmtMs(d)}`;
}

/** 一条 traceroute 的逐跳表：补上每跳位置（IPmap）和归属网络（RIPEstat），并在地球上画出路径。 */
export default function TraceDetail({ probe, trace, target, onOverlay }: Props) {
  const { t } = useI18n();
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

  useEffect(() => {
    const points: TraceOverlay['points'] = [{ lat: probe.lat, lng: probe.lng, kind: 'probe', label: t('marker.probe', { id: probe.id }) }];
    for (const h of trace.hops) {
      const loc = h.ip ? enriched?.locations.get(h.ip) : null;
      if (!loc || !feasible(probe, loc, h.minRtt)) continue;
      const prev = points[points.length - 1];
      if (haversineKm(prev.lat, prev.lng, loc.lat, loc.lng) < 20) continue;
      points.push({ lat: loc.lat, lng: loc.lng, kind: 'hop', hop: h.hop, label: t('marker.hop', { hop: h.hop, ip: h.ip!, city: loc.city }) });
    }
    const last = points[points.length - 1];
    if (haversineKm(last.lat, last.lng, target.lat, target.lng) >= 20 || points.length === 1) {
      points.push({ lat: target.lat, lng: target.lng, kind: 'target', label: target.label });
    }
    onOverlay({ points });
  }, [probe, trace, target, enriched, onOverlay, t]);

  useEffect(() => () => onOverlay(null), [onOverlay]);

  const rows = useMemo(() => {
    let prevRtt: number | null = null;
    let prevLoc: IpLocation | null = null;
    return trace.hops.map((h) => {
      const loc = h.ip ? enriched?.locations.get(h.ip) ?? null : null;
      const net = h.ip ? enriched?.networks.get(h.ip) ?? null : null;
      const ok = loc ? feasible(probe, loc, h.minRtt) : false;
      const delta = h.minRtt !== null && prevRtt !== null ? h.minRtt - prevRtt : null;
      const jumpKm = loc && ok && prevLoc ? haversineKm(prevLoc.lat, prevLoc.lng, loc.lat, loc.lng) : null;
      if (h.minRtt !== null) prevRtt = h.minRtt;
      if (loc && ok) prevLoc = loc;
      return { h, loc, ok, net, delta, jumpKm };
    });
  }, [probe, trace, enriched]);

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
          {rows.map(({ h, loc, ok, net, delta, jumpKm }) => (
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
                {loc ? (
                  <span className={ok ? '' : 'loc-bad'} title={ok ? undefined : t('atlas.badLoc')}>
                    {loc.city}
                    {loc.country ? `, ${loc.country}` : ''}
                  </span>
                ) : h.ip && !h.isPrivate && !enriched ? (
                  '…'
                ) : (
                  '—'
                )}
              </td>
              <td className="num">{h.minRtt !== null ? fmtMs(h.minRtt) : ''}</td>
              <td className={`num ${delta !== null && delta > 15 ? 'jump' : ''}`}>
                {delta !== null ? fmtDelta(delta) : ''}
                {delta !== null && delta > 15 && jumpKm !== null && jumpKm > 300 && <div className="hop-jump">≈{fmtKm(jumpKm)} km</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">{t('atlas.footnote')}</p>
    </>
  );
}
