import { useEffect, useMemo, useState } from 'react';
import { findNearbyTraces, latestPing, type NearbyTrace, type PingResult, type SearchProgress } from '../lib/atlas.ts';
import { useI18n, type Translate } from '../lib/i18n.tsx';
import { providerName } from '../lib/names.ts';
import { PROVIDER_BY_ID } from '../lib/providers.ts';
import type { AnchorProbe, AnchorRef, Region } from '../lib/types.ts';
import type { TraceOverlay } from './GlobeView.tsx';
import { fmtKm, fmtMs } from './RegionList.tsx';
import TraceDetail from './TraceDetail.tsx';

interface Props {
  region: Region;
  origin: { lat: number; lng: number };
  anchorProbes: AnchorProbe[];
  onOverlay: (overlay: TraceOverlay | null) => void;
}

export function ago(ts: number, t: Translate) {
  const min = Math.round((Date.now() / 1000 - ts) / 60);
  if (min < 1) return t('ago.now');
  if (min < 60) return t('ago.min', { n: min });
  const h = Math.round(min / 60);
  return h < 48 ? t('ago.hour', { n: h }) : t('ago.day', { n: Math.round(h / 24) });
}

/** RIPE Atlas 公开的 anchoring 测量：离点击处最近的参与探针到该区域同网/同城锚点的最新 traceroute。 */
export default function RouteAtlas({ region, origin, anchorProbes, onOverlay }: Props) {
  const { lang, t } = useI18n();
  const [anchorIdx, setAnchorIdx] = useState(0);
  const anchor: AnchorRef | undefined = region.anchors[anchorIdx];
  const [status, setStatus] = useState<SearchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [traces, setTraces] = useState<NearbyTrace[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [ping, setPing] = useState<PingResult | null>(null);

  useEffect(() => {
    if (!anchor) return;
    const ctrl = new AbortController();
    setTraces(null);
    setError(null);
    setSelected(0);
    findNearbyTraces(anchor, origin.lat, origin.lng, anchorProbes, ctrl.signal, setStatus)
      .then((found) => {
        setTraces(found);
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

  useEffect(() => {
    if (!current || !anchor) return;
    const ctrl = new AbortController();
    setPing(null);
    (async () => {
      for (const m of anchor.ping) {
        const p = await latestPing(m, current.probe.id, ctrl.signal).catch(() => null);
        if (p?.min) return setPing(p);
      }
    })();
    return () => ctrl.abort();
  }, [current, anchor]);

  const target = useMemo(() => (anchor ? { lat: anchor.lat, lng: anchor.lng, label: anchor.fqdn } : null), [anchor]);

  if (!region.anchors.length) {
    return (
      <div className="atlas-empty">
        <p>{t('atlas.none')}</p>
        <p className="muted">{t('atlas.noneHint')}</p>
      </div>
    );
  }

  const provider = providerName(PROVIDER_BY_ID[region.provider], lang);
  const lastHop = current ? [...current.trace.hops].reverse().find((h) => h.minRtt !== null) : undefined;
  return (
    <div className="route-atlas">
      <p className="muted small">{t('atlas.source')}</p>
      <div className="anchor-picker">
        {region.anchors.map((a, i) => (
          <button key={a.id} className={`chip ${i === anchorIdx ? 'chip-on' : ''}`} onClick={() => setAnchorIdx(i)}>
            {t(a.sameProvider ? 'atlas.same' : 'atlas.proxy')} · {a.fqdn.replace('.anchors.atlas.ripe.net', '')}
          </button>
        ))}
      </div>
      {anchor && (
        <p className="anchor-note">
          {anchor.sameProvider
            ? t('atlas.sameNote', { provider, asn: anchor.asn, company: anchor.company })
            : t('atlas.proxyNote', { provider, asn: anchor.asn, company: anchor.company, km: anchor.distanceKm })}
        </p>
      )}

      {status && (
        <p className="status">
          {status.stage === 'probes' ? t('atlas.searching', { radius: status.radius }) : t('atlas.reading', { n: status.count, target: status.target })}
        </p>
      )}
      {error && <p className="error">{t('atlas.error', { msg: error })}</p>}
      {traces && !traces.length && <p className="muted">{t('atlas.noProbes')}</p>}

      {traces && traces.length > 0 && (
        <>
          <div className="probe-picker">
            {traces.map((tr, i) => (
              <button key={tr.probe.id} className={`chip ${i === selected ? 'chip-on' : ''}`} onClick={() => setSelected(i)}>
                #{tr.probe.id} {tr.probe.country} · {fmtKm(tr.probe.distanceKm)} km{tr.probe.isAnchor ? ' ⚓' : ''}
              </button>
            ))}
          </div>
          {current && target && (
            <>
              <div className="summary-grid">
                <div>
                  <span className="summary-label">{t('atlas.ping')}</span>
                  <span className="summary-value">{ping?.min ? `${fmtMs(ping.min)} ms` : '…'}</span>
                </div>
                <div>
                  <span className="summary-label">{t('atlas.lastHop')}</span>
                  <span className="summary-value dim">{lastHop ? `${fmtMs(lastHop.minRtt!)} ms` : '—'}</span>
                </div>
                <div>
                  <span className="summary-label">{t('atlas.probe')}</span>
                  <span className="summary-value dim">
                    <a href={`https://atlas.ripe.net/probes/${current.probe.id}/`} target="_blank" rel="noreferrer">
                      #{current.probe.id}
                    </a>{' '}
                    AS{current.probe.asn ?? '?'}
                  </span>
                </div>
                <div>
                  <span className="summary-label">{t('atlas.time')}</span>
                  <span className="summary-value dim">{ago(current.trace.timestamp, t)}</span>
                </div>
              </div>
              {current.probe.distanceKm > 300 && <p className="muted small">{t('atlas.far', { km: fmtKm(current.probe.distanceKm) })}</p>}
              <TraceDetail probe={current.probe} trace={current.trace} target={target} onOverlay={onOverlay} />
            </>
          )}
        </>
      )}
    </div>
  );
}
