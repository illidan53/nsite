import { useRef, type KeyboardEvent } from 'react';
import { calibratedRtt, calibrationRule } from '../lib/calibration.ts';
import { haversineKm } from '../lib/geo.ts';
import { useI18n } from '../lib/i18n.tsx';
import { mineFor, type MeasuredOrigin } from '../lib/measured.ts';
import { providerName, regionName } from '../lib/names.ts';
import type { Place } from '../lib/places.ts';
import { PROVIDER_BY_ID } from '../lib/providers.ts';
import type { EstimatedRoute } from '../lib/routing.ts';
import type { AnchorProbe, MeasuredData, Region, TestTarget } from '../lib/types.ts';
import type { Sheet } from '../lib/layout.ts';
import Flag from './Flag.tsx';
import type { TraceOverlay } from './GlobeView.tsx';
import type { RouteTab } from './Panel.tsx';
import PersonalMeasure from './PersonalMeasure.tsx';
import { fmtCoord } from './PlaceOverview.tsx';
import { fmtKm, fmtMs, type RankedRegion } from './RegionList.tsx';
import RouteAtlas from './RouteAtlas.tsx';
import RouteEstimate from './RouteEstimate.tsx';
import { SourceBanner } from './Sources.tsx';

const TABS: RouteTab[] = ['estimate', 'mine', 'atlas'];

interface Props {
  open: boolean;
  dock: 'side' | 'bottom';
  mobile: boolean;
  sheet: Sheet;
  origin: { lat: number; lng: number };
  place: Place | null;
  onLand: boolean;
  target: Region;
  tab: RouteTab;
  route: EstimatedRoute | null;
  measuredData: MeasuredData | null;
  /** 可用的实测地区（自己省优先，再按距离）；这个数据中心用哪个由 mineFor 决定。 */
  measuredOrigins: MeasuredOrigin[];
  anchorProbes: AnchorProbe[];
  publicTarget: TestTarget | undefined;
  owner: boolean;
  /** 校准用的起点国家（ISO2）。 */
  originCountry: string | null;
  /** 步进（上一个 / 下一个）用的列表：选择器当前的顺序。 */
  steps: RankedRegion[];
  onBack: () => void;
  onClose: () => void;
  onSelect: (r: Region) => void;
  onTab: (t: RouteTab) => void;
  onSheet: (s: Sheet) => void;
  onRecenter: () => void;
  onHoverRange: (r: [number, number] | null) => void;
  onOverlay: (o: TraceOverlay | null) => void;
}

/** 选中数据中心后的路线卡：不挡地球（宽屏停靠右侧，窄屏从底部弹出），三类数据并排对比。 */
export default function RouteCard(props: Props) {
  const { open, dock, mobile, sheet, origin, place, onLand, target, tab, route, measuredData, measuredOrigins, steps } = props;
  const { lang, t, pick } = useI18n();
  const tabsRef = useRef<HTMLDivElement>(null);
  const p = PROVIDER_BY_ID[target.provider];
  const country = place?.country;
  const fromName = country
    ? [place?.admin1 ? pick(place.admin1.name, place.admin1.nameZh) : null, pick(country.name, country.nameZh)].filter(Boolean).join(', ')
    : t(onLand ? 'place.unknown' : 'place.ocean');

  const { ms: targetMine, unreached: targetUnreached, origin: measuredOrigin } = mineFor(measuredOrigins, target, origin);
  const pair = measuredOrigin?.cell.regions[target.id];
  const runDate = pair ? (measuredData?.runs[pair.run]?.createdAt.slice(0, 10) ?? '') : '';
  // 估算 = 物理最短路径 + 按站长实测校准的路由与排队开销
  const estimateMs = route && onLand ? calibratedRtt(route.rttMs, { originCountry: props.originCountry, regionCountry: target.countryCode }) : null;
  const rule = calibrationRule(props.originCountry, target.countryCode);
  const tabValue = (s: RouteTab) => {
    if (s === 'estimate') return estimateMs !== null ? `${fmtMs(estimateMs)} ms` : '—';
    if (s === 'mine') return targetMine !== null ? `${fmtMs(targetMine)} ms` : targetUnreached ? t('mine.unreachedShort') : '—';
    const a = target.anchors[0];
    return a ? t(a.sameProvider ? 'tab.anchorSame' : 'tab.anchorProxy') : t('tab.none');
  };
  const tabSub = (s: RouteTab) =>
    s === 'estimate'
      ? t('src.qual.estimate')
      : s === 'mine'
        ? (targetMine !== null || targetUnreached) && measuredOrigin
          ? t('src.qual.mineFrom', { cell: measuredOrigin.kind === 'own' ? measuredOrigin.id : `${measuredOrigin.id} · ${fmtKm(measuredOrigin.km)} km`, date: runDate })
          : t('src.qual.mineNone')
        : t('src.qual.atlas');

  const idx = steps.findIndex((i) => i.region.id === target.id);
  const prev = idx > 0 ? steps[idx - 1].region : null;
  const next = idx >= 0 && idx < steps.length - 1 ? steps[idx + 1].region : null;
  const nameOf = (r: Region) => `${providerName(PROVIDER_BY_ID[r.provider], lang)} ${regionName(r, lang)}`;

  // 数据来源：方向键只移动焦点，回车 / 空格才切换（避免划过“锚点参考”就开始请求 RIPE）
  const onTabsKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = [...(tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role=tab]') ?? [])];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : null;
    if (to === null || i < 0) return;
    e.preventDefault();
    list[(to + list.length) % list.length]?.focus();
  };

  // 到头时用 aria-disabled 而不是 disabled：按钮保留焦点和名字，键盘连按不会把焦点丢到 body
  const stepper = idx >= 0 && (
    <span className="route-stepper">
      <button
        className="icon-button small"
        aria-disabled={!prev}
        onClick={() => prev && props.onSelect(prev)}
        aria-label={prev ? t('route.prev', { dc: nameOf(prev) }) : t('route.prev', { dc: '—' })}
      >
        ‹
      </button>
      <span className="route-rank">{t('route.rank', { n: idx + 1, total: steps.length })}</span>
      <button
        className="icon-button small"
        aria-disabled={!next}
        onClick={() => next && props.onSelect(next)}
        aria-label={next ? t('route.next', { dc: nameOf(next) }) : t('route.next', { dc: '—' })}
      >
        ›
      </button>
    </span>
  );
  const recenter = (
    <button className="icon-button small" onClick={props.onRecenter} aria-label={t('route.recenter')} title={t('route.recenter')}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10 1.5v4M10 14.5v4M1.5 10h4M14.5 10h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  );

  return (
    <section
      className="route-card"
      data-state={open ? 'open' : 'closed'}
      data-dock={dock}
      data-sheet={sheet}
      aria-labelledby="route-title"
      inert={!open}
      data-label-avoid
    >
      {dock === 'bottom' && <span className="sheet-handle" aria-hidden="true" />}
      <header className="route-head">
        <div className="route-row1">
          <button className="icon-button" onClick={props.onBack} aria-label={t('route.backTo', { place: fromName })} title={t('route.backTo', { place: fromName })}>
            ‹
          </button>
          <span className="route-from" title={fmtCoord(origin.lat, origin.lng)}>
            {country && <Flag iso2={country.iso2} title={country.name} />}
            <span className="ellipsis">{fromName}</span>
          </span>
          <span className="route-actions">
            {!mobile && stepper}
            {!mobile && recenter}
            {dock === 'bottom' && (
              <button
                className="icon-button sheet-toggle"
                aria-expanded={sheet === 'full'}
                aria-label={t(sheet === 'full' ? 'route.collapse' : 'route.expand')}
                onClick={() => props.onSheet(sheet === 'full' ? 'peek' : 'full')}
              >
                {sheet === 'full' ? '⌄' : '⌃'}
              </button>
            )}
            <button className="icon-button" onClick={props.onClose} aria-label={t('place.close')} title={t('place.close')}>
              ×
            </button>
          </span>
        </div>
        <h2 className="route-title" id="route-title" tabIndex={-1}>
          <span className="dot" style={{ background: p.color }} />
          <span className="ellipsis">
            <b style={{ color: p.color }}>{providerName(p, lang)}</b> {regionName(target, lang)}
          </span>
        </h2>
        <div className="route-meta">
          <span>
            {target.code} · {target.city}, {target.country} · {t('route.gc', { km: fmtKm(haversineKm(origin.lat, origin.lng, target.lat, target.lng)) })}
          </span>
          {mobile && (
            <span className="route-actions">
              {stepper}
              {recenter}
            </span>
          )}
        </div>
      </header>

      <div className="source-tabs" role="tablist" aria-label={t('route.sources')} ref={tabsRef} onKeyDown={onTabsKey}>
        {TABS.map((s) => (
          <button
            key={s}
            role="tab"
            id={`tab-${s}`}
            aria-controls={`panel-${s}`}
            aria-selected={tab === s}
            tabIndex={tab === s ? 0 : -1}
            className={`src-${s} ${tab === s ? 'tab-on' : ''}`}
            onClick={() => props.onTab(s)}
          >
            <span className="tab-label">
              <span className="src-swatch" aria-hidden="true" />
              <span className="ellipsis">{t(`tab.${s}`)}</span>
            </span>
            <span className={`tab-value ${s === 'atlas' || (s === 'mine' && targetUnreached) ? 'tab-value-text' : ''}`}>{tabValue(s)}</span>
            <span className="tab-sub">{tabSub(s)}</span>
          </button>
        ))}
      </div>

      <div className="route-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <div key={`${target.id}|${tab}`} className="route-body-inner">
          {tab === 'estimate' && (
            <>
              <SourceBanner source="estimate" title={t('src.banner.estimate.title')}>
                {t('src.banner.estimate')}
              </SourceBanner>
              {onLand ? <RouteEstimate route={route} estimateMs={estimateMs} rule={rule} onHover={props.onHoverRange} /> : <p className="muted">{t('panel.oceanRoute')}</p>}
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
        </div>
      </div>
    </section>
  );
}
