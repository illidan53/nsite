import { useEffect, useMemo, useState } from 'react';
import {
  findNearbyTraces,
  latestPing,
  locateIps,
  networksForIps,
  type IpLocation,
  type IpNetwork,
  type NearbyTrace,
  type PingResult,
} from '../lib/atlas.ts';
import { haversineKm } from '../lib/geo.ts';
import { FIBER_KM_PER_MS } from '../lib/routing.ts';
import { PROVIDER_BY_ID } from '../lib/providers.ts';
import type { AnchorProbe, AnchorRef, Region } from '../lib/types.ts';
import type { TraceOverlay } from './GlobeView.tsx';
import { fmtKm, fmtMs } from './RegionList.tsx';

interface Props {
  region: Region;
  origin: { lat: number; lng: number };
  anchorProbes: AnchorProbe[];
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
function feasible(probe: { lat: number; lng: number }, loc: IpLocation, minRtt: number | null) {
  if (minRtt === null) return true;
  return haversineKm(probe.lat, probe.lng, loc.lat, loc.lng) <= (minRtt / 2) * FIBER_KM_PER_MS + 100;
}

function ago(ts: number) {
  const min = Math.round((Date.now() / 1000 - ts) / 60);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} 小时前` : `${Math.round(h / 24)} 天前`;
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

export default function RouteAtlas({ region, origin, anchorProbes, onOverlay }: Props) {
  const [anchorIdx, setAnchorIdx] = useState(0);
  const anchor: AnchorRef | undefined = region.anchors[anchorIdx];
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [traces, setTraces] = useState<NearbyTrace[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [enriched, setEnriched] = useState<Enriched | null>(null);
  const [ping, setPing] = useState<PingResult | null>(null);

  // 1. 找附近有结果的探针
  useEffect(() => {
    if (!anchor) return;
    const ctrl = new AbortController();
    setTraces(null);
    setError(null);
    setSelected(0);
    findNearbyTraces(anchor, origin.lat, origin.lng, anchorProbes, ctrl.signal, setStatus)
      .then((t) => {
        setTraces(t);
        setStatus(null);
      })
      .catch((err: Error) => {
        if (!ctrl.signal.aborted) {
          setError(err.message);
          setStatus(null);
        }
      });
    return () => ctrl.abort();
  }, [anchor, origin.lat, origin.lng, anchorProbes]);

  const current = traces?.[selected] ?? null;

  // 2. 给选中的 traceroute 补上每跳的位置和所属网络，以及同一探针的 ping
  useEffect(() => {
    if (!current || !anchor) return;
    const ctrl = new AbortController();
    setEnriched(null);
    setPing(null);
    const ips = current.trace.hops.filter((h) => h.ip && !h.isPrivate).map((h) => h.ip!);
    Promise.all([locateIps(ips, ctrl.signal), networksForIps(ips, ctrl.signal)])
      .then(([locations, networks]) => setEnriched({ locations, networks }))
      .catch(() => {
        if (!ctrl.signal.aborted) setEnriched({ locations: new Map(), networks: new Map() });
      });
    (async () => {
      for (const m of anchor.ping) {
        const p = await latestPing(m, current.probe.id, ctrl.signal).catch(() => null);
        if (p?.min) return setPing(p);
      }
    })();
    return () => ctrl.abort();
  }, [current, anchor]);

  // 3. 生成地球上的叠加层
  useEffect(() => {
    if (!current || !anchor) {
      onOverlay(null);
      return;
    }
    const points: TraceOverlay['points'] = [
      { lat: current.probe.lat, lng: current.probe.lng, kind: 'probe', label: `探针 #${current.probe.id}` },
    ];
    for (const h of current.trace.hops) {
      const loc = h.ip ? enriched?.locations.get(h.ip) : null;
      if (!loc || !feasible(current.probe, loc, h.minRtt)) continue;
      const prev = points[points.length - 1];
      if (haversineKm(prev.lat, prev.lng, loc.lat, loc.lng) < 20) continue;
      points.push({ lat: loc.lat, lng: loc.lng, kind: 'hop', hop: h.hop, label: `第 ${h.hop} 跳 ${h.ip} · ${loc.city}` });
    }
    const last = points[points.length - 1];
    if (haversineKm(last.lat, last.lng, anchor.lat, anchor.lng) >= 20 || points.length === 1) {
      points.push({ lat: anchor.lat, lng: anchor.lng, kind: 'target', label: anchor.fqdn });
    }
    onOverlay({ points });
  }, [current, enriched, anchor, onOverlay]);

  useEffect(() => () => onOverlay(null), [onOverlay]);

  const rows = useMemo(() => {
    if (!current) return [];
    let prevRtt: number | null = null;
    let prevLoc: IpLocation | null = null;
    return current.trace.hops.map((h) => {
      const loc = h.ip ? enriched?.locations.get(h.ip) ?? null : null;
      const net = h.ip ? enriched?.networks.get(h.ip) ?? null : null;
      const ok = loc ? feasible(current.probe, loc, h.minRtt) : false;
      const delta = h.minRtt !== null && prevRtt !== null ? h.minRtt - prevRtt : null;
      const jumpKm = loc && ok && prevLoc ? haversineKm(prevLoc.lat, prevLoc.lng, loc.lat, loc.lng) : null;
      if (h.minRtt !== null) prevRtt = h.minRtt;
      if (loc && ok) prevLoc = loc;
      return { h, loc, ok, net, delta, jumpKm };
    });
  }, [current, enriched]);

  if (!region.anchors.length) {
    return (
      <div className="atlas-empty">
        <p>这个区域附近没有 RIPE Atlas 锚点，拿不到公开的持续测量数据。</p>
        <p className="muted">
          可以用自己的 RIPE Atlas 积分，从离起点最近的探针向该区域的公网端点发起一次性 traceroute（需要 API
          key，由后端代理）。目前还没有实现这个功能。
        </p>
      </div>
    );
  }

  const provider = PROVIDER_BY_ID[region.provider];
  return (
    <div className="route-atlas">
      <div className="anchor-picker">
        {region.anchors.map((a, i) => (
          <button key={a.id} className={`chip ${i === anchorIdx ? 'chip-on' : ''}`} onClick={() => setAnchorIdx(i)}>
            {a.sameProvider ? '同网' : '同城'} · {a.fqdn.replace('.anchors.atlas.ripe.net', '')}
          </button>
        ))}
      </div>
      {anchor && (
        <p className="anchor-note">
          {anchor.sameProvider ? (
            <>
              目标锚点托管在 <b>{provider.name}</b> 网络内（AS{anchor.asn}，{anchor.company}），路径直达云厂商网络。
            </>
          ) : (
            <>
              目标锚点位于同城 {anchor.distanceKm} km 处的 <b>{anchor.company}</b>（AS{anchor.asn}），不在 {provider.name}
              网络内：到达该城市的线路是真实的，最后进入云厂商网络的那段会有差别。
            </>
          )}
        </p>
      )}

      {status && <p className="status">{status}</p>}
      {error && <p className="error">请求 RIPE Atlas 失败：{error}</p>}
      {traces && !traces.length && <p className="muted">4000 km 内没有参与该锚点测量的探针。</p>}

      {traces && traces.length > 0 && (
        <>
          <div className="probe-picker">
            {traces.map((t, i) => (
              <button key={t.probe.id} className={`chip ${i === selected ? 'chip-on' : ''}`} onClick={() => setSelected(i)}>
                #{t.probe.id} {t.probe.country} · {fmtKm(t.probe.distanceKm)} km{t.probe.isAnchor ? ' ⚓' : ''}
              </button>
            ))}
          </div>
          {current && (
            <>
              <div className="summary-grid">
                <div>
                  <span className="summary-label">实测 RTT（ping 最小值）</span>
                  <span className="summary-value">{ping?.min ? `${fmtMs(ping.min)} ms` : '…'}</span>
                </div>
                <div>
                  <span className="summary-label">traceroute 末跳</span>
                  <span className="summary-value dim">
                    {(() => {
                      const last = [...current.trace.hops].reverse().find((h) => h.minRtt !== null);
                      return last ? `${fmtMs(last.minRtt!)} ms` : '—';
                    })()}
                  </span>
                </div>
                <div>
                  <span className="summary-label">起点探针</span>
                  <span className="summary-value dim">
                    <a href={`https://atlas.ripe.net/probes/${current.probe.id}/`} target="_blank" rel="noreferrer">
                      #{current.probe.id}
                    </a>{' '}
                    AS{current.probe.asn ?? '?'}
                  </span>
                </div>
                <div>
                  <span className="summary-label">测量时间</span>
                  <span className="summary-value dim">{ago(current.trace.timestamp)}</span>
                </div>
              </div>
              {current.probe.distanceKm > 300 && (
                <p className="muted small">
                  附近没有参与该锚点测量的探针，最近的起点在 {fmtKm(current.probe.distanceKm)} km 外，结果只能作为区域参考。
                </p>
              )}
              {!current.trace.reached && <p className="muted">这次 traceroute 没有收到目标应答，最后几跳可能缺失。</p>}

              <table className="hops">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>路由器 / 网络</th>
                    <th>位置</th>
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
                        {h.isPrivate && <span className="muted"> 内网</span>}
                        {net?.asn && (
                          <div className="hop-net">
                            AS{net.asn} {shortHolder(net.holder)}
                          </div>
                        )}
                      </td>
                      <td>
                        {loc ? (
                          <span
                            className={ok ? '' : 'loc-bad'}
                            title={ok ? undefined : '与 RTT 矛盾：光在这么短的时间内到不了这里，IP 定位多半有误'}
                          >
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
                        {delta !== null && delta > 15 && jumpKm !== null && jumpKm > 300 && (
                          <div className="hop-jump">≈{fmtKm(jumpKm)} km</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                数据：RIPE Atlas anchoring 测量（每 15 分钟一次）；跳点位置来自 RIPE IPmap，归属网络来自 RIPEstat。Δ
                为与上一跳最小 RTT 之差，路由器对 ICMP 的处理优先级较低，个别跳会出现负值或尖峰。划线的位置不满足光速约束（RTT
                太小、距离太远），已从地球上的路径中排除。
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
