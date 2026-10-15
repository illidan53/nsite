import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { calibratedRtt } from '../lib/calibration.ts';
import { useI18n } from '../lib/i18n.tsx';
import type { PlaceLayout, Sheet, Stage } from '../lib/layout.ts';
import type { MeasuredOrigins } from '../lib/measured.ts';
import { providerName, regionName } from '../lib/names.ts';
import type { Place } from '../lib/places.ts';
import { PROVIDER_BY_ID } from '../lib/providers.ts';
import type { EstimatedRoute } from '../lib/routing.ts';
import type { AnchorProbe, MeasuredData, ProviderId, Region, TestTarget } from '../lib/types.ts';
import type { TraceOverlay } from './GlobeView.tsx';
import MiniPill from './MiniPill.tsx';
import PlaceOverview from './PlaceOverview.tsx';
import { ALL_PROVIDERS, FIRST, RegionChooser, chooserLists, fmtKm, fmtMs, type RankedRegion, type SortBy } from './RegionList.tsx';
import RouteCard from './RouteCard.tsx';

export type RouteTab = 'estimate' | 'mine' | 'atlas';

interface Props {
  stage: Stage;
  layout: PlaceLayout;
  sheet: Sheet;
  origin: { lat: number; lng: number } | null;
  place: Place | null;
  onLand: boolean;
  /** 全部数据中心（按估算 RTT 排序，带站长实测）。 */
  all: RankedRegion[];
  /** 左上角厂商筛选：打开新地点时选择器的厂商按它预选。 */
  enabled: Set<ProviderId>;
  /** 批量站长实测结果，以及点击位置对应的起点地区。 */
  measuredData: MeasuredData | null;
  measuredOrigins: MeasuredOrigins;
  target: Region | null;
  tab: RouteTab;
  route: EstimatedRoute | null;
  anchorProbes: AnchorProbe[];
  /** 该区域的公开测试地址（站长实测的目标）。 */
  publicTarget: TestTarget | undefined;
  owner: boolean;
  /** 校准用的起点国家（ISO2），见 App。 */
  originCountry: string | null;
  /** 打开选择窗口的那次点击在屏幕上的位置（窗口从这里放大）。 */
  openFrom: { x: number; y: number } | null;
  recent: Region | null;
  onClose: () => void;
  onSelect: (r: Region | null) => void;
  onTab: (t: RouteTab) => void;
  onMinimize: () => void;
  onRestore: () => void;
  onRecenter: () => void;
  onSheet: (s: Sheet) => void;
  onHoverRange: (r: [number, number] | null) => void;
  onOverlay: (o: TraceOverlay | null) => void;
}

const seedProviders = (enabled: Set<ProviderId>) => new Set<ProviderId>(enabled.size ? enabled : ALL_PROVIDERS);

/**
 * 点击地球后的界面：
 * overview —— 屏幕中间的选择窗口（遮罩挡住地球），左边地点概况，右边按延迟排好的数据中心选择器；
 * minimized —— 收起成底部小条，地球可以自由操作；
 * route —— 停靠在一边（窄屏在底部）的路线卡，地球上画出路线。
 */
export default function Panel(props: Props) {
  const { stage, layout, sheet, origin, place, onLand, all, enabled, target, measuredData, measuredOrigins, openFrom, recent } = props;
  const measuredOrigin = measuredOrigins.nearest;
  const { lang, t, pick } = useI18n();
  const overviewOpen = stage === 'overview';

  const originKey = origin ? `${origin.lat},${origin.lng}` : '';

  // ---------------------------------------------------------------- 选择器状态（在这里，返回列表和步进时都能用）
  // 搜索词只对当前地点有效：换了地点就清空，免得把新地点最近的数据中心过滤掉（返回列表时保留）
  const [search, setSearch] = useState({ key: originKey, q: '' });
  const query = search.key === originKey ? search.q : '';
  const setQuery = useCallback((q: string) => setSearch({ key: originKey, q }), [originKey]);
  const [sortBy, setSortBy] = useState<SortBy>('estimate');
  const seedKey = `${originKey}|${[...enabled].sort().join(',')}`;
  const [prov, setProv] = useState(() => ({ key: seedKey, set: seedProviders(enabled) }));
  if (prov.key !== seedKey) setProv({ key: seedKey, set: seedProviders(enabled) });
  const providers = prov.set;
  const limitKey = `${originKey}|${[...providers].sort().join(',')}|${query}|${sortBy}`;
  const [paging, setPaging] = useState({ key: limitKey, limit: FIRST });
  if (paging.key !== limitKey) setPaging({ key: limitKey, limit: FIRST });

  const hasMine = all.some((r) => r.mineMs !== null || r.mineUnreached);
  // 按实测排序：有值的按值，其次没测过的（按估算），最后是测了不通的
  const mineKey = (r: RankedRegion) => r.mineMs ?? (r.mineUnreached ? 2e9 : 1e9);
  // 默认按模型估算（传入时已排好）；选“实测”时有实测的在前，其余仍按估算。
  const sorted = useMemo(
    () => (sortBy === 'mine' && hasMine ? [...all].sort((a, b) => mineKey(a) - mineKey(b) || a.rttMs - b.rttMs) : all),
    [all, sortBy, hasMine],
  );
  const { ranked, visible, rank, hidden } = useMemo(() => chooserLists(sorted, providers, query), [sorted, providers, query]);
  const steps = target && visible.some((i) => i.region.id === target.id) ? visible : sorted;

  const runDate = (i: number) => measuredData?.runs[i]?.createdAt.slice(0, 10) ?? '';
  const legendNote = !measuredOrigin
    ? t('src.mineNone')
    : measuredOrigin.tooFar
      ? t('src.mineTooFar', { cell: measuredOrigin.id, km: fmtKm(measuredOrigin.km) })
      : t(measuredOrigin.kind === 'own' ? 'src.mineFrom' : measuredOrigin.kind === 'near' ? 'src.mineFromNear' : 'src.mineFromCountry', {
          cell: measuredOrigin.id,
          km: fmtKm(measuredOrigin.km),
          date: runDate(Math.max(0, ...Object.values(measuredOrigin.cell.regions).map((p) => p.run))),
        });

  // ---------------------------------------------------------------- 窗口动画起点、滚动、焦点
  const fwRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  /** 最近看过路线的数据中心和当时的地点：只有地点没变（真正“返回”）时才把焦点放回那一行。 */
  const lastTarget = useRef<{ id: string; originKey: string } | null>(null);
  if (target) lastTarget.current = { id: target.id, originKey };

  // 打开时从点击处放大；收起时缩向底部小条，从小条展开时也从底部放大
  const fwPrev = useRef({ stage, openFrom });
  useLayoutEffect(() => {
    const el = fwRef.current;
    if (!el) return;
    const prev = fwPrev.current;
    fwPrev.current = { stage, openFrom };
    const restored = prev.stage === 'minimized' && prev.openFrom === openFrom;
    let ox = '50%';
    let oy = stage === 'minimized' || layout.mobile || restored ? '100%' : '50%';
    if (stage === 'overview' && openFrom && !layout.mobile && !restored) {
      const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
      ox = `${clamp(openFrom.x - el.offsetLeft, el.offsetWidth)}px`;
      oy = `${clamp(openFrom.y - el.offsetTop, el.offsetHeight)}px`;
    }
    el.style.setProperty('--fw-ox', ox);
    el.style.setProperty('--fw-oy', oy);
  }, [stage, openFrom, layout.mobile]);

  // 换了地点：列表回到顶部
  useEffect(() => {
    fwRef.current?.querySelectorAll('.fw-main, .fw-body').forEach((el) => (el.scrollTop = 0));
  }, [originKey]);

  const prevStage = useRef<Stage>(stage);
  useEffect(() => {
    const prev = prevStage.current;
    prevStage.current = stage;
    if (prev === stage) return;
    const fine = window.matchMedia?.('(pointer: fine)').matches ?? true;
    const focus = (el: HTMLElement | null | undefined) => el?.focus({ preventScroll: true });
    if (prev === 'idle' && stage !== 'idle') {
      const a = document.activeElement;
      returnFocus.current = a instanceof HTMLElement && a !== document.body && !a.closest('.globe-layer') ? a : null;
    }
    if (stage === 'overview') {
      const lt = lastTarget.current;
      const row =
        prev === 'route' && lt && lt.originKey === originKey
          ? fwRef.current?.querySelector<HTMLElement>(`[data-region-id="${CSS.escape(lt.id)}"]`)
          : null;
      if (row) {
        row.scrollIntoView({ block: 'nearest' });
        focus(row);
      } else if (fine) focus(searchRef.current);
      else focus(document.getElementById('fw-title'));
    } else if (stage === 'minimized') focus(pillRef.current);
    else if (stage === 'route') focus(document.getElementById('route-title'));
    else if (stage === 'idle') {
      const back = returnFocus.current;
      if (back?.isConnected && !back.closest('[inert]')) focus(back);
      else focus(document.querySelector<HTMLElement>('.globe-layer'));
    }
  }, [stage]);

  // “/” 聚焦搜索（收起时先展开）
  const restoreAndSearch = useRef(false);
  const { onRestore } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (stage === 'overview') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (stage === 'minimized') {
        e.preventDefault();
        restoreAndSearch.current = true;
        onRestore();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, onRestore]);
  useEffect(() => {
    if (stage === 'overview' && restoreAndSearch.current) {
      restoreAndSearch.current = false;
      searchRef.current?.focus();
    }
  }, [stage]);

  const onProviders = useCallback((set: Set<ProviderId>) => setProv((p) => ({ ...p, set })), []);
  const onLimit = useCallback((limit: number) => setPaging((p) => ({ ...p, limit })), []);

  // 读屏：进入选择窗口 / 路线时播报一句（数量在进入时定下，打字筛选不重复播报）
  const placeName = place?.admin1
    ? pick(place.admin1.name, place.admin1.nameZh)
    : place?.country
      ? pick(place.country.name, place.country.nameZh)
      : t(onLand ? 'place.unknown' : 'place.ocean');
  const statusSnap = useRef({ key: '', n: 0 });
  const statusKey = `${stage}|${originKey}`;
  if (statusSnap.current.key !== statusKey) statusSnap.current = { key: statusKey, n: visible.length };
  const status =
    stage === 'overview'
      ? t('a11y.place', { place: placeName, n: statusSnap.current.n })
      : stage === 'route' && target
        ? t('a11y.route', {
            dc: `${providerName(PROVIDER_BY_ID[target.provider], lang)} ${regionName(target, lang)}`,
            ms: props.route && onLand ? `${fmtMs(calibratedRtt(props.route.rttMs, { originCountry: props.originCountry, regionCountry: target.countryCode }))} ms` : '—',
          })
        : '';

  // 关闭时窗口要淡出一会儿：这段时间继续显示最后一次的内容，避免先变空（“0 个数据中心”）再消失
  const lastOverview = useRef<ReactNode>(null);
  if (origin) {
    lastOverview.current = (
      <PlaceOverview
        origin={origin}
        place={place}
        onLand={onLand}
        mobile={layout.mobile}
        onMinimize={props.onMinimize}
        onClose={props.onClose}
        chooser={
          <RegionChooser
            sorted={sorted}
            visible={visible}
            rank={rank}
            hidden={hidden}
            providers={providers}
            onProviders={onProviders}
            query={query}
            onQuery={setQuery}
            sortBy={sortBy}
            onSortBy={setSortBy}
            hasMine={hasMine}
            limit={paging.limit}
            onLimit={onLimit}
            note={legendNote}
            onLand={onLand}
            recent={recent}
            searchRef={searchRef}
            onSelect={props.onSelect}
          />
        }
      />
    );
  }

  return (
    <>
      <div className="fw-scrim" data-state={overviewOpen ? 'open' : 'closed'} onClick={props.onMinimize} aria-hidden="true" />
      <section
        ref={fwRef}
        className="fw"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fw-title"
        aria-describedby="fw-sub"
        data-state={overviewOpen ? 'open' : 'closed'}
        inert={!overviewOpen}
      >
        {lastOverview.current}
      </section>

      {stage === 'minimized' && (
        <MiniPill
          place={place}
          onLand={onLand}
          lowest={ranked[0]}
          useMine={sortBy === 'mine' && hasMine}
          openRef={pillRef}
          onOpen={props.onRestore}
          onClose={props.onClose}
        />
      )}

      {target && origin && (
        <RouteCard
          open={stage === 'route'}
          dock={layout.dock}
          mobile={layout.mobile}
          sheet={sheet}
          origin={origin}
          place={place}
          onLand={onLand}
          target={target}
          tab={props.tab}
          route={props.route}
          measuredData={measuredData}
          measuredOrigins={measuredOrigins.usable}
          anchorProbes={props.anchorProbes}
          publicTarget={props.publicTarget}
          owner={props.owner}
          originCountry={props.originCountry}
          steps={steps}
          onBack={() => props.onSelect(null)}
          onClose={props.onClose}
          onSelect={props.onSelect}
          onTab={props.onTab}
          onSheet={props.onSheet}
          onRecenter={props.onRecenter}
          onHoverRange={props.onHoverRange}
          onOverlay={props.onOverlay}
        />
      )}

      <p className="sr-only" role="status">
        {status}
      </p>
    </>
  );
}
