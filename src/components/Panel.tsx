import { useCallback, useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import { bestRtt, type MeasuredOrigin } from '../lib/measured.ts';
import { providerName, regionName } from '../lib/names.ts';
import type { Place } from '../lib/places.ts';
import { PROVIDER_BY_ID } from '../lib/providers.ts';
import type { EstimatedRoute } from '../lib/routing.ts';
import type { AnchorProbe, MeasuredData, Region, TestTarget } from '../lib/types.ts';
import Flag from './Flag.tsx';
import type { TraceOverlay } from './GlobeView.tsx';
import PlaceInfo from './PlaceInfo.tsx';
import { RegionList, RegionPicker, fmtMs, type RankedRegion } from './RegionList.tsx';
import PersonalMeasure from './PersonalMeasure.tsx';
import RouteAtlas from './RouteAtlas.tsx';
import RouteEstimate from './RouteEstimate.tsx';
import Section from './Section.tsx';
import { SourceBanner, SourceLegend } from './Sources.tsx';

export type RouteTab = 'estimate' | 'mine' | 'atlas';
const TABS: RouteTab[] = ['estimate', 'mine', 'atlas'];
type SortBy = 'estimate' | 'mine';

interface Props {
  open: boolean;
  origin: { lat: number; lng: number } | null;
  place: Place | null;
  onLand: boolean;
  /** 附近（已按厂商筛选、按估算 RTT 排序）。 */
  nearby: RankedRegion[];
  /** 批量站长实测结果，以及点击位置对应的起点地区。 */
  measuredData: MeasuredData | null;
  measuredOrigin: MeasuredOrigin | null;
  /** 全部数据中心，供“任选”使用。 */
  all: RankedRegion[];
  target: Region | null;
  tab: RouteTab;
  route: EstimatedRoute | null;
  anchorProbes: AnchorProbe[];
  /** 该区域的公开测试地址（站长实测的目标）。 */
  publicTarget: TestTarget | undefined;
  owner: boolean;
  onClose: () => void;
  onSelect: (r: Region | null) => void;
  onTab: (t: RouteTab) => void;
  onHoverRange: (r: [number, number] | null) => void;
  onOverlay: (o: TraceOverlay | null) => void;
}

function fmtCoord(lat: number, lng: number) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'}`;
}

export default function Panel(props: Props) {
  const { open, origin, place, onLand, nearby, all, target, tab, route, measuredData, measuredOrigin } = props;
  const { lang, t, pick } = useI18n();
  const country = place?.country;
  const admin1 = place?.admin1;
  const [sortBy, setSortBy] = useState<SortBy>('estimate');
  const hasMine = all.some((r) => r.mineMs !== null);
  // 两个列表都按延迟从小到大：默认用模型估算（传入时已排好）；选“实测”时有实测的在前，其余仍按估算。
  const byLatency = useCallback(
    (items: RankedRegion[]) =>
      sortBy === 'mine' && hasMine
        ? [...items].sort((a, b) => (a.mineMs ?? Infinity) - (b.mineMs ?? Infinity) || a.rttMs - b.rttMs)
        : items,
    [sortBy, hasMine],
  );
  const sortedNearby = useMemo(() => byLatency(nearby), [byLatency, nearby]);
  const sortedAll = useMemo(() => byLatency(all), [byLatency, all]);
  const sortControl = hasMine ? (
    <span className="sort-toggle" role="group" aria-label={t('panel.sortBy')}>
      {(['estimate', 'mine'] as SortBy[]).map((k) => (
        <button key={k} className={`src-${k} ${sortBy === k ? 'sort-on' : ''}`} aria-pressed={sortBy === k} onClick={() => setSortBy(k)}>
          {t(`sort.${k}`)}
        </button>
      ))}
    </span>
  ) : (
    <span className="muted">{t('panel.nearbySort')}</span>
  );

  const runDate = (i: number) => measuredData?.runs[i]?.createdAt.slice(0, 10) ?? '';
  const legendNote = measuredOrigin
    ? t(measuredOrigin.exact ? 'src.mineFrom' : 'src.mineFromNear', {
        cell: measuredOrigin.id,
        date: runDate(Math.max(0, ...Object.values(measuredOrigin.cell.regions).map((p) => p.run))),
      })
    : t('src.mineNone');
  const targetMine = target ? bestRtt(measuredOrigin?.cell.regions[target.id]) : null;
  const tabValue = (s: RouteTab) => {
    if (!target) return '';
    if (s === 'estimate') return route && onLand ? `${fmtMs(route.rttMs)} ms` : '—';
    if (s === 'mine') return targetMine !== null ? `${fmtMs(targetMine)} ms` : '—';
    const a = target.anchors[0];
    return a ? t(a.sameProvider ? 'tab.anchorSame' : 'tab.anchorProxy') : t('tab.none');
  };

  return (
    <aside className={`panel ${open ? 'panel-open' : ''}`} aria-hidden={!open}>
      {origin && (
        <>
          <header className="panel-header">
            <div>
              <div className="place-title">
                {country ? (
                  <>
                    {admin1 && <span>{pick(admin1.name, admin1.nameZh)}</span>}
                    <span className={admin1 ? 'place-country' : ''}>
                      {pick(country.name, country.nameZh)}
                      <Flag iso2={country.iso2} title={country.name} />
                    </span>
                  </>
                ) : (
                  <span>{t(onLand ? 'place.unknown' : 'place.ocean')}</span>
                )}
              </div>
              <div className="place-sub">
                {country && lang === 'zh' && (
                  <>
                    {admin1 ? `${admin1.name}, ` : ''}
                    {country.name} ·{' '}
                  </>
                )}
                {admin1?.type ? `${admin1.type} · ` : ''}
                {fmtCoord(origin.lat, origin.lng)}
              </div>
            </div>
            <button className="icon-button" onClick={props.onClose} aria-label={t('place.close')}>
              ×
            </button>
          </header>

          {target ? (
            <section className="panel-body">
              <button className="link-button back" onClick={() => props.onSelect(null)}>
                {t('panel.back')}
              </button>
              <div className="target-title">
                <span className="dot" style={{ background: PROVIDER_BY_ID[target.provider].color }} />
                <div>
                  <b style={{ color: PROVIDER_BY_ID[target.provider].color }}>{providerName(PROVIDER_BY_ID[target.provider], lang)}</b>{' '}
                  {regionName(target, lang)}
                  <div className="place-sub">
                    {target.code} · {target.city}, {target.country}
                  </div>
                </div>
              </div>
              <div className="tabs tabs-3 source-tabs" role="tablist">
                {TABS.map((s) => (
                  <button
                    key={s}
                    role="tab"
                    aria-selected={tab === s}
                    className={`src-${s} ${tab === s ? 'tab-on' : ''}`}
                    onClick={() => props.onTab(s)}
                  >
                    <span className="tab-label">
                      <span className="src-swatch" aria-hidden="true" />
                      {t(`tab.${s}`)}
                    </span>
                    <span className="tab-value">{tabValue(s)}</span>
                  </button>
                ))}
              </div>
              {tab === 'estimate' && (
                <>
                  <SourceBanner source="estimate" title={t('src.banner.estimate.title')}>
                    {t('src.banner.estimate')}
                  </SourceBanner>
                  {onLand ? <RouteEstimate route={route} onHover={props.onHoverRange} /> : <p className="muted">{t('panel.oceanRoute')}</p>}
                </>
              )}
              {tab === 'mine' && (
                <PersonalMeasure
                  key={`${target.id}|${origin.lat},${origin.lng}`}
                  region={target}
                  origin={origin}
                  place={place}
                  publicTarget={props.publicTarget}
                  measuredData={measuredData}
                  measuredOrigin={measuredOrigin}
                  owner={props.owner}
                  onOverlay={props.onOverlay}
                />
              )}
              {tab === 'atlas' && (
                <>
                  <SourceBanner source="atlas" title={t('src.banner.atlas.title')}>
                    {t('src.banner.atlas')}
                  </SourceBanner>
                  <RouteAtlas key={target.id} region={target} origin={origin} anchorProbes={props.anchorProbes} onOverlay={props.onOverlay} />
                </>
              )}
            </section>
          ) : (
            <div className="panel-body">
              <PlaceInfo origin={origin} place={place} />
              <Section
                storageKey="nsite-section-nearby"
                defaultOpen
                title={t('panel.nearby')}
                aside={sortControl}
              >
                <SourceLegend note={legendNote} />
                {!onLand && <p className="muted small">{t('panel.oceanNote')}</p>}
                <RegionList key={`${origin.lat},${origin.lng},${sortBy}`} items={sortedNearby} onSelect={(r) => props.onSelect(r)} />
              </Section>
              <Section storageKey="nsite-section-any" defaultOpen={false} title={t('panel.any')} aside={sortControl}>
                <RegionPicker items={sortedAll} onSelect={(r) => props.onSelect(r)} />
              </Section>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
