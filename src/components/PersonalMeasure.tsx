import { useCallback, useEffect, useMemo, useState } from 'react';
import { cellOf, listMeasurements, measurementResults, startMeasurement, type MeasureProbe, type Measurement } from '../lib/api.ts';
import type { TraceResult } from '../lib/atlas.ts';
import { haversineKm } from '../lib/geo.ts';
import { useI18n } from '../lib/i18n.tsx';
import type { MeasuredOrigin } from '../lib/measured.ts';
import type { Place } from '../lib/places.ts';
import type { MeasuredData, Region, TestTarget } from '../lib/types.ts';
import type { TraceOverlay } from './GlobeView.tsx';
import { fmtKm, fmtMs } from './RegionList.tsx';
import { ago } from './RouteAtlas.tsx';
import { SourceBanner } from './Sources.tsx';
import TraceDetail from './TraceDetail.tsx';

interface Props {
  region: Region;
  origin: { lat: number; lng: number };
  place: Place | null;
  /** 该区域的公开测试地址（站长实测的唯一目标）。 */
  publicTarget: TestTarget | undefined;
  measuredData: MeasuredData | null;
  measuredOrigin: MeasuredOrigin | null;
  owner: boolean;
  onOverlay: (overlay: TraceOverlay | null) => void;
}

/** 一次 traceroute 每个探针 30 积分，一次性测量翻倍；后端每次选 3 个探针。 */
const CREDITS = 3 * 60;
const POLL_MS = 15_000;
const POLL_WINDOW_MS = 20 * 60_000;

/** 一次站长实测：批量测量里该起点地区的那部分，或站长单次补测。 */
interface Entry {
  key: string;
  kind: 'batch' | 'single';
  createdAt: string;
  msmId: number;
  target: string;
  cell: string;
  /** 批量结果借用了同一国家里最近的已测地区。 */
  near: boolean;
  probes: MeasureProbe[];
  /** 批量结果里已知的到达 RTT（按探针）。 */
  known: Map<number, number | null>;
}

function lastRtt(r: TraceResult | undefined) {
  return r ? [...r.hops].reverse().find((h) => h.minRtt !== null)?.minRtt ?? null : null;
}

/** 站长用个人 RIPE Atlas 账号发起的实测：他人托管的探针 → 该数据中心的公开地址。 */
export default function PersonalMeasure({ region, origin, place, publicTarget, measuredData, measuredOrigin, owner, onOverlay }: Props) {
  const { t } = useI18n();
  const cell = cellOf(place);
  const pk = cell ? `${cell.cell}|${region.id}` : null;
  const [items, setItems] = useState<Measurement[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [entryKey, setEntryKey] = useState<string | null>(null);
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

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];
    const pair = measuredOrigin?.cell.regions[region.id];
    if (pair && measuredOrigin && measuredData) {
      const probes = pair.results.flatMap((r): MeasureProbe[] => {
        const p = measuredData.probes[r.probe];
        if (!p) return [];
        return [{ id: r.probe, lat: p.lat, lng: p.lng, asn: p.asn, country: p.cc, anchor: false, distanceKm: haversineKm(origin.lat, origin.lng, p.lat, p.lng) }];
      });
      list.push({
        key: `batch-${pair.msm}`,
        kind: 'batch',
        createdAt: new Date(pair.at * 1000).toISOString(),
        msmId: pair.msm,
        target: pair.target,
        cell: measuredOrigin.id,
        near: !measuredOrigin.exact,
        probes: probes.sort((a, b) => a.distanceKm - b.distanceKm),
        known: new Map(pair.results.map((r) => [r.probe, r.rtt])),
      });
    }
    // 只收对公开地址的测量；早期对同城锚点的代测属于“锚点参考”，不混在这里。
    for (const m of items ?? []) {
      if (m.kind !== 'public') continue;
      list.push({
        key: `single-${m.msmId}`,
        kind: 'single',
        createdAt: m.createdAt,
        msmId: m.msmId,
        target: m.target,
        cell: m.origin.cell,
        near: false,
        probes: m.probes,
        known: new Map(),
      });
    }
    return list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [items, measuredOrigin, measuredData, region.id, origin.lat, origin.lng]);

  const entry = entries.find((e) => e.key === entryKey) ?? entries[0] ?? null;

  // 读取选中测量的结果；单次补测刚创建时每 15 秒刷新一次，直到所有探针都有结果。
  useEffect(() => {
    if (!entry) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setResults(null);
    setSelected(0);
    const ids = entry.kind === 'batch' ? entry.probes.map((p) => p.id) : undefined;
    const load = () =>
      measurementResults(entry.msmId, ctrl.signal, ids)
        .then((r) => {
          setResults(r);
          const fresh = entry.kind === 'single' && Date.now() - Date.parse(entry.createdAt) < POLL_WINDOW_MS;
          if (r.length < entry.probes.length && fresh) timer = setTimeout(load, POLL_MS);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) timer = setTimeout(load, POLL_MS);
        });
    load();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [entry]);

  const run = useCallback(async () => {
    if (!cell) return;
    setBusy(true);
    setError(null);
    try {
      const m = await startMeasurement({ lat: origin.lat, lng: origin.lng, country: cell.country, cell: cell.cell, region: region.id });
      setItems((prev) => [m, ...(prev ?? [])]);
      setEntryKey(`single-${m.msmId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [cell, origin.lat, origin.lng, region.id]);

  const probe = entry?.probes[selected];
  const trace = results?.find((r) => r.probeId === probe?.id) ?? null;
  const target = useMemo(() => ({ lat: region.lat, lng: region.lng, label: entry?.target ?? region.code, city: region.city }), [region, entry]);
  const lastHop = trace ? [...trace.hops].reverse().find((h) => h.minRtt !== null) : undefined;

  useEffect(() => {
    if (!trace) onOverlay(null);
  }, [trace, onOverlay]);

  const probeRtt = (e: Entry, id: number) => {
    const r = results?.find((x) => x.probeId === id);
    if (r) return r.reached ? lastRtt(r) : null;
    return e.known.get(id) ?? null;
  };

  return (
    <div className="route-mine">
      <SourceBanner source="mine" title={t('mine.noticeTitle')}>
        {t('mine.notice')}
      </SourceBanner>

      {publicTarget ? (
        <p className="mine-target">
          {t('mine.target')} <span className="mono">{publicTarget.host}</span>
          <span className="muted">
            {' '}
            · {t('mine.kind.public')} · {t(publicTarget.method === 'icmp' ? 'mine.proto.icmp' : 'mine.proto.tcp')}
          </span>
        </p>
      ) : (
        <p className="muted">{t('mine.noTarget')}</p>
      )}

      {!cell && <p className="muted">{t('mine.noCell')}</p>}

      {cell && publicTarget && owner && (
        <div className="mine-actions">
          <button className="primary-button" onClick={run} disabled={busy}>
            {busy ? t('mine.running') : t(entries.length ? 'mine.rerun' : 'mine.run', { credits: CREDITS })}
          </button>
          <span className="muted small">{t('mine.ownerHint', { cell: cell.cell })}</span>
        </div>
      )}
      {error && <p className="error">{t('mine.error', { msg: error })}</p>}

      {cell && loadError && <p className="muted">{t('mine.apiDown')}</p>}
      {cell && publicTarget && (items !== null || loadError) && !entries.length && (
        <p className="muted">
          {t('mine.none', { cell: cell.cell })} {!owner && t('mine.ownerOnly')}
        </p>
      )}

      {entry && (
        <>
          {entries.length > 1 && (
            <div className="probe-picker">
              {entries.map((e) => (
                <button key={e.key} className={`chip ${e.key === entry.key ? 'chip-on' : ''}`} onClick={() => setEntryKey(e.key)}>
                  {t(e.kind === 'batch' ? 'mine.batch' : 'mine.single')} · {ago(Date.parse(e.createdAt) / 1000, t)}
                </button>
              ))}
            </div>
          )}
          <p className="mine-meta">
            {t(entry.kind === 'batch' ? 'mine.batch' : 'mine.single')} · {t(entry.near ? 'mine.fromNear' : 'mine.from', { cell: entry.cell })} ·{' '}
            {t('mine.measuredAt', { ago: ago(Date.parse(entry.createdAt) / 1000, t) })} ·{' '}
            <a href={`https://atlas.ripe.net/measurements/${entry.msmId}/`} target="_blank" rel="noreferrer">
              {t('mine.link', { id: entry.msmId })}
            </a>
          </p>
          {entry.kind === 'single' && results && results.length < entry.probes.length && (
            <p className="status">{t('mine.waiting', { got: results.length, n: entry.probes.length })}</p>
          )}
          <div className="probe-picker">
            {entry.probes.map((p, i) => {
              const rtt = probeRtt(entry, p.id);
              const done = results?.some((x) => x.probeId === p.id) || entry.known.has(p.id);
              return (
                <button key={p.id} className={`chip ${i === selected ? 'chip-on' : ''}`} onClick={() => setSelected(i)}>
                  #{p.id} AS{p.asn} · {fmtKm(p.distanceKm)} km
                  {rtt !== null ? ` · ${fmtMs(rtt)} ms` : done ? ` · ${t('mine.unreached')}` : ''}
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
          {probe && results && !trace && results.length >= entry.probes.length && <p className="muted">{t('mine.noResult')}</p>}
        </>
      )}
    </div>
  );
}
