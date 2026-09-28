import { useCallback, useEffect, useMemo, useState } from 'react';
import { cellOf, listMeasurements, measurementResults, startMeasurement, type Measurement } from '../lib/api.ts';
import type { TraceResult } from '../lib/atlas.ts';
import { useI18n } from '../lib/i18n.tsx';
import type { Place } from '../lib/places.ts';
import type { Region, TestTarget } from '../lib/types.ts';
import type { TraceOverlay } from './GlobeView.tsx';
import { fmtKm, fmtMs } from './RegionList.tsx';
import { ago } from './RouteAtlas.tsx';
import TraceDetail from './TraceDetail.tsx';

interface Props {
  region: Region;
  origin: { lat: number; lng: number };
  place: Place | null;
  /** 该区域的公开测试地址（没有时后端改用同城/同网锚点）。 */
  publicTarget: TestTarget | undefined;
  owner: boolean;
  onOverlay: (overlay: TraceOverlay | null) => void;
}

/** 一次 traceroute 每个探针 30 积分，一次性测量翻倍；后端每次选 3 个探针。 */
const CREDITS = 3 * 60;
const POLL_MS = 15_000;
const POLL_WINDOW_MS = 20 * 60_000;

/** 站长用个人 RIPE Atlas 账号发起的实测：从点击所在国家的探针到该数据中心。 */
export default function PersonalMeasure({ region, origin, place, publicTarget, owner, onOverlay }: Props) {
  const { t } = useI18n();
  const cell = cellOf(place);
  const pk = cell ? `${cell.cell}|${region.id}` : null;
  const [items, setItems] = useState<Measurement[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [results, setResults] = useState<TraceResult[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pk) return;
    const ctrl = new AbortController();
    setItems(null);
    setLoadError(false);
    listMeasurements(pk, ctrl.signal)
      .then(setItems)
      .catch(() => {
        if (!ctrl.signal.aborted) setLoadError(true);
      });
    return () => ctrl.abort();
  }, [pk]);

  const latest = items?.[0] ?? null;

  // 读取最新一次测量的结果；测量刚创建时每 15 秒刷新一次，直到所有探针都有结果。
  useEffect(() => {
    if (!latest) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setResults(null);
    setSelected(0);
    const load = () =>
      measurementResults(latest.msmId, ctrl.signal)
        .then((r) => {
          setResults(r);
          const fresh = Date.now() - Date.parse(latest.createdAt) < POLL_WINDOW_MS;
          if (r.length < latest.probes.length && fresh) timer = setTimeout(load, POLL_MS);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) timer = setTimeout(load, POLL_MS);
        });
    load();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [latest]);

  const run = useCallback(async () => {
    if (!cell) return;
    setBusy(true);
    setError(null);
    try {
      const m = await startMeasurement({ lat: origin.lat, lng: origin.lng, country: cell.country, cell: cell.cell, region: region.id });
      setItems((prev) => [m, ...(prev ?? [])]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [cell, origin.lat, origin.lng, region.id]);

  const probe = latest?.probes[selected];
  const trace = results?.find((r) => r.probeId === probe?.id) ?? null;
  const target = useMemo(() => ({ lat: region.lat, lng: region.lng, label: latest?.target ?? region.code }), [region, latest]);
  const lastHop = trace ? [...trace.hops].reverse().find((h) => h.minRtt !== null) : undefined;

  useEffect(() => {
    if (!trace) onOverlay(null);
  }, [trace, onOverlay]);

  const anchor = region.anchors[0];
  const plannedTarget = publicTarget
    ? { host: publicTarget.host, kind: t('mine.kind.public'), proto: publicTarget.method === 'icmp' ? 'ICMP' : 'TCP' }
    : anchor
      ? {
          host: anchor.fqdn,
          kind: anchor.sameProvider ? t('mine.kind.anchorSame') : t('mine.kind.anchorProxy', { km: anchor.distanceKm }),
          proto: 'ICMP',
        }
      : null;

  return (
    <div className="route-mine">
      <div className="callout callout-strong">
        <b>{t('mine.noticeTitle')}</b>
        <p>{t('mine.notice')}</p>
      </div>

      {plannedTarget ? (
        <p className="mine-target">
          {t('mine.target')} <span className="mono">{plannedTarget.host}</span>
          <span className="muted"> · {plannedTarget.kind} · {t(plannedTarget.proto === 'ICMP' ? 'mine.proto.icmp' : 'mine.proto.tcp')}</span>
        </p>
      ) : (
        <p className="muted">{t('mine.noTarget')}</p>
      )}

      {!cell && <p className="muted">{t('mine.noCell')}</p>}

      {cell && plannedTarget && owner && (
        <div className="mine-actions">
          <button className="primary-button" onClick={run} disabled={busy}>
            {busy ? t('mine.running') : t(latest ? 'mine.rerun' : 'mine.run', { credits: CREDITS })}
          </button>
          <span className="muted small">{t('mine.ownerHint', { cell: cell.cell })}</span>
        </div>
      )}
      {error && <p className="error">{t('mine.error', { msg: error })}</p>}

      {cell && loadError && <p className="muted">{t('mine.apiDown')}</p>}
      {cell && items && !items.length && (
        <p className="muted">
          {t('mine.none', { cell: cell.cell })} {!owner && t('mine.ownerOnly')}
        </p>
      )}

      {latest && (
        <>
          <p className="mine-meta">
            {t('mine.measuredAt', { ago: ago(Date.parse(latest.createdAt) / 1000, t) })} ·{' '}
            <a href={`https://atlas.ripe.net/measurements/${latest.msmId}/`} target="_blank" rel="noreferrer">
              {t('mine.link', { id: latest.msmId })}
            </a>
          </p>
          {results && results.length < latest.probes.length && (
            <p className="status">{t('mine.waiting', { got: results.length, n: latest.probes.length })}</p>
          )}
          <div className="probe-picker">
            {latest.probes.map((p, i) => {
              const r = results?.find((x) => x.probeId === p.id);
              const last = r ? [...r.hops].reverse().find((h) => h.minRtt !== null) : undefined;
              return (
                <button key={p.id} className={`chip ${i === selected ? 'chip-on' : ''}`} onClick={() => setSelected(i)}>
                  #{p.id} AS{p.asn} · {fmtKm(p.distanceKm)} km{last?.minRtt != null ? ` · ${fmtMs(last.minRtt)} ms` : ''}
                </button>
              );
            })}
          </div>
          {probe && (
            <div className="summary-grid">
              <div>
                <span className="summary-label">{t('atlas.lastHop')}</span>
                <span className="summary-value">{lastHop ? `${fmtMs(lastHop.minRtt!)} ms` : trace ? '—' : '…'}</span>
              </div>
              <div>
                <span className="summary-label">{t('atlas.probe')}</span>
                <span className="summary-value dim">
                  <a href={`https://atlas.ripe.net/probes/${probe.id}/`} target="_blank" rel="noreferrer">
                    #{probe.id}
                  </a>{' '}
                  AS{probe.asn} · {probe.country}
                </span>
              </div>
            </div>
          )}
          {probe && trace && <TraceDetail probe={probe} trace={trace} target={target} onOverlay={onOverlay} />}
          {probe && results && !trace && results.length >= latest.probes.length && <p className="muted">{t('mine.noResult')}</p>}
          {items && items.length > 1 && (
            <details className="assumptions">
              <summary>{t('mine.history')}</summary>
              <ul>
                {items.slice(1).map((m) => (
                  <li key={m.msmId}>
                    {new Date(m.createdAt).toLocaleString()} ·{' '}
                    <a href={`https://atlas.ripe.net/measurements/${m.msmId}/`} target="_blank" rel="noreferrer">
                      #{m.msmId}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
