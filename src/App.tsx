import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import GlobeView, { type CameraTarget, type TraceOverlay } from './components/GlobeView.tsx';
import Panel, { type RouteTab } from './components/Panel.tsx';
import TargetsPanel from './components/TargetsPanel.tsx';
import type { RankedRegion } from './components/RegionList.tsx';
import { whoami } from './lib/api.ts';
import { loadAppData, type AppData } from './lib/data.ts';
import { RouteGraphContext } from './lib/graphContext.ts';
import { loadMeasured, measuredOriginsFor, mineFor } from './lib/measured.ts';
import { haversineKm } from './lib/geo.ts';
import { useI18n, type Lang } from './lib/i18n.tsx';
import { placeLayout, routeCamera, type Sheet, type Stage } from './lib/layout.ts';
import { providerName } from './lib/names.ts';
import { lookupCountry, lookupPlace, type Place } from './lib/places.ts';
import { PROVIDERS } from './lib/providers.ts';
import { estimateRtt, routeTo, shortestFrom } from './lib/routing.ts';
import { THEMES, THEME_IDS, initialTheme, saveTheme, type ThemeId } from './lib/themes.ts';
import type { MeasuredData, ProviderId, Region, TargetsData } from './lib/types.ts';
import { usePrefersReducedMotion, useWindowSize } from './lib/useWindowSize.ts';
import { fetchViewerLocation, viewerLabel, type ViewerLocation } from './lib/viewer.ts';

const THEME_KEY = { midnight: 'theme.midnight', night: 'theme.night', marble: 'theme.marble', dots: 'theme.dots', light: 'theme.light' } as const;

export default function App() {
  const { lang, setLang, t } = useI18n();
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [enabled, setEnabled] = useState<Set<ProviderId>>(() => new Set(PROVIDERS.map((p) => p.id)));
  const [target, setTarget] = useState<Region | null>(null);
  const [tab, setTab] = useState<RouteTab>('estimate');
  const [activeRange, setActiveRange] = useState<[number, number] | null>(null);
  const [overlay, setOverlay] = useState<TraceOverlay | null>(null);
  const [showCables, setShowCables] = useState(true);
  const [showPlanned, setShowPlanned] = useState(false);
  const [camera, setCamera] = useState<CameraTarget | null>(null);
  const [themeId, setThemeId] = useState<ThemeId>(initialTheme);
  const [viewer, setViewer] = useState<ViewerLocation | null>(null);
  const [ipsData, setIpsData] = useState<TargetsData | null>(null);
  const [ipsOpen, setIpsOpen] = useState(false);
  const [ipSel, setIpSel] = useState<string | null>(null);
  const [owner, setOwner] = useState(false);
  const [measured, setMeasured] = useState<MeasuredData | null>(null);
  /** 选择窗口收起成底部小条。 */
  const [minimized, setMinimized] = useState(false);
  /** 底部路线抽屉：半屏 / 全屏。 */
  const [sheet, setSheet] = useState<Sheet>('peek');
  /** 打开选择窗口的点击位置（屏幕坐标）。 */
  const [openFrom, setOpenFrom] = useState<{ x: number; y: number } | null>(null);
  /** 在路线页点了新起点时，刚才看的数据中心。 */
  const [recent, setRecent] = useState<Region | null>(null);
  const { w, h } = useWindowSize();
  const reduced = usePrefersReducedMotion();
  const pickSeq = useRef(0);
  const targetRef = useRef<Region | null>(null);
  targetRef.current = target;
  const originRef = useRef<{ lat: number; lng: number } | null>(null);
  originRef.current = origin;
  const theme = THEMES[themeId];
  /** 系统要求减少动态效果时镜头直接跳过去。 */
  const cam = useCallback((c: CameraTarget): CameraTarget => (reduced ? { ...c, ms: 0 } : c), [reduced]);
  const routeView = useCallback(
    (from: { lat: number; lng: number }, to: Region) => cam(routeCamera(from, to, placeLayout(w, h, 'route', 'peek').free, h)),
    [cam, w, h],
  );

  useEffect(() => {
    loadAppData().then(setData, (err: Error) => setLoadError(err.message));
    whoami().then((w) => setOwner(Boolean(w?.owner)));
    loadMeasured().then(setMeasured);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.ui = theme.ui;
    saveTheme(themeId);
  }, [theme, themeId]);

  const sp = useMemo(() => (data && origin ? shortestFrom(data.graph, origin.lat, origin.lng) : null), [data, origin]);

  const regions = useMemo(() => data?.network.regions.filter((r) => enabled.has(r.provider)) ?? [], [data, enabled]);
  const regionById = useMemo(() => new Map((data?.network.regions ?? []).map((r) => [r.id, r])), [data]);
  /** 有公开测试 IP 的区域（“公开测试 IP”面板打开时地球上只显示这些）。 */
  const ipRegions = useMemo(
    () => (ipsData?.targets ?? []).map((x) => regionById.get(x.region)).filter((r): r is Region => Boolean(r)),
    [ipsData, regionById],
  );

  /** 点击位置对应的批量站长实测起点地区。 */
  const measuredOrigins = useMemo(() => measuredOriginsFor(measured, place, origin), [measured, place, origin]);

  /** 全部数据中心（不受左上角厂商筛选影响），按估算 RTT 排序；有站长实测时一并带上（两者分开存放，不混算）。 */
  const rankedAll = useMemo<RankedRegion[]>(() => {
    if (!data || !origin) return [];
    return data.network.regions
      .map((region) => {
        const mine = mineFor(measuredOrigins.usable, region, origin);
        return {
          region,
          distanceKm: haversineKm(origin.lat, origin.lng, region.lat, region.lng),
          rttMs: estimateRtt(data.graph, sp, region, origin.lat, origin.lng),
          mineMs: mine.ms,
          mineUnreached: mine.unreached,
          mineFrom: mine.origin,
        };
      })
      .sort((a, b) => a.rttMs - b.rttMs);
  }, [data, origin, sp, measuredOrigins]);

  const route = useMemo(() => (data && sp && target ? routeTo(data.graph, sp, target) : null), [data, sp, target]);

  const pick = useCallback(
    (lat: number, lng: number, at?: { x: number; y: number }) => {
      if (!data) return;
      setIpsOpen(false);
      setOrigin({ lat, lng });
      setRecent(targetRef.current);
      setTarget(null);
      setMinimized(false);
      setSheet('peek');
      setOpenFrom(at ?? null);
      setOverlay(null);
      setActiveRange(null);
      setPlace({ country: lookupCountry(data.countries, lat, lng), admin1: null });
      setCamera(cam({ lat, lng, altitude: 1.9 }));
      const seq = ++pickSeq.current;
      lookupPlace(data.countries, lat, lng).then((p) => {
        if (seq === pickSeq.current) setPlace(p);
      });
    },
    [data, cam],
  );

  const selectRegion = useCallback(
    (r: Region | null) => {
      setTarget(r);
      setMinimized(false);
      setRecent(null);
      setOverlay(null);
      setActiveRange(null);
      if (r && origin) setCamera(routeView(origin, r));
      else if (origin) setCamera(cam({ ...origin, altitude: 1.9 }));
    },
    [origin, routeView, cam],
  );

  // 首次载入：URL 深链接优先；否则按访问者 IP 的大致位置稍微拉近。
  useEffect(() => {
    if (!data) return;
    const q = new URLSearchParams(window.location.search);
    const lat = Number(q.get('lat'));
    const lng = Number(q.get('lng'));
    const deepLink = q.has('lat') && q.has('lng') && Number.isFinite(lat) && Number.isFinite(lng);
    if (deepLink) {
      pick(lat, lng);
      const r = data.network.regions.find((x) => x.id === q.get('dc'));
      if (r) {
        setTarget(r);
        const tabParam = q.get('tab');
        setTab(tabParam === 'atlas' || tabParam === 'mine' ? tabParam : 'estimate');
        setCamera(routeView({ lat, lng }, r));
      }
    }
    fetch('/data/targets.json')
      .then((r) => (r.ok ? (r.json() as Promise<TargetsData>) : null))
      .then((d) => {
        if (!d) return;
        setIpsData(d);
        if (q.has('ips')) {
          setIpsOpen(true);
          // 和 openIps 一样：有地点、没有路线时先收起，关掉 IP 面板后回到底部小条
          if (deepLink && !data.network.regions.some((x) => x.id === q.get('dc'))) setMinimized(true);
          const id = q.get('ip');
          const r = id ? data.network.regions.find((x) => x.id === id) : undefined;
          if (r && d.targets.some((x) => x.region === r.id)) {
            setIpSel(r.id);
            setCamera(cam({ lat: r.lat, lng: r.lng, altitude: 1.6 }));
          }
        }
      })
      .catch(() => {});
    const ctrl = new AbortController();
    fetchViewerLocation(ctrl.signal).then((v) => {
      if (!v) return;
      setViewer(v);
      // 位置返回得晚时用户可能已经点了地球，不再把镜头拉走
      if (!deepLink && !q.has('ips') && !originRef.current) setCamera(cam({ lat: v.lat, lng: v.lng, altitude: 1.7, ms: 2400 }));
    });
    return () => ctrl.abort();
    // 只在数据首次就绪时执行一次
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const q = new URLSearchParams();
    if (ipsOpen) {
      q.set('ips', '1');
      if (ipSel) q.set('ip', ipSel);
    }
    if (origin) {
      q.set('lat', origin.lat.toFixed(4));
      q.set('lng', origin.lng.toFixed(4));
      if (target) {
        q.set('dc', target.id);
        if (tab !== 'estimate') q.set('tab', tab);
      }
    }
    const qs = q.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [data, origin, target, tab, ipsOpen, ipSel]);

  const selectIp = useCallback(
    (id: string | null) => {
      setIpSel(id);
      const r = id ? regionById.get(id) : null;
      if (r) setCamera(cam({ lat: r.lat, lng: r.lng, altitude: 1.6 }));
    },
    [regionById, cam],
  );

  const openIps = useCallback(() => {
    setIpsOpen(true);
    setIpSel(null);
    // 从选择窗口打开时先收起，关掉 IP 面板后回到底部小条，不会突然又弹出窗口
    if (origin && !target) setMinimized(true);
  }, [origin, target]);

  const onRegionClick = useCallback(
    (r: Region) => {
      if (ipsOpen) selectIp(r.id);
      else if (origin) selectRegion(r);
      else pick(r.lat, r.lng);
    },
    [ipsOpen, origin, selectIp, selectRegion, pick],
  );

  const close = useCallback(() => {
    setOrigin(null);
    setTarget(null);
    setOverlay(null);
    setPlace(null);
    setMinimized(false);
    setRecent(null);
  }, []);
  const minimize = useCallback(() => setMinimized(true), []);
  const restore = useCallback(() => setMinimized(false), []);
  const recenter = useCallback(() => {
    if (origin && target) setCamera(routeView(origin, target));
  }, [origin, target, routeView]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 搜索框里的 Esc 先清空搜索词（已 preventDefault）
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (ipsOpen) {
        if (ipSel) setIpSel(null);
        else setIpsOpen(false);
      } else if (target) selectRegion(null);
      else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ipsOpen, ipSel, target, selectRegion, close]);

  const stage: Stage = ipsOpen ? 'ips' : !origin ? 'idle' : target ? 'route' : minimized ? 'minimized' : 'overview';
  const layout = useMemo(() => placeLayout(w, h, stage, sheet), [w, h, stage, sheet]);
  const { mobile, dock } = layout;
  const [ox, oy] = layout.offset;
  const offset = useMemo<[number, number]>(() => [ox, oy], [ox, oy]);
  const modal = stage === 'overview';
  /** 手机上选择窗口、路线和 IP 面板打开时 HUD 让位（也不能被 Tab 到）。 */
  const hudHidden = mobile && (stage === 'overview' || stage === 'route' || stage === 'ips');

  const stageRef = useRef(stage);
  stageRef.current = stage;
  // 路线页里转屏或缩放窗口导致停靠方式变化时，重新取景（IP 面板打开时不动镜头）
  useEffect(() => {
    if (stageRef.current === 'route' && origin && targetRef.current) setCamera({ ...routeView(origin, targetRef.current), ms: reduced ? 0 : 600 });
    // 只在停靠方式变化时执行
  }, [dock, mobile]);

  const toggleProvider = (id: ProviderId) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const counts = useMemo(() => {
    const m = new Map<ProviderId, number>();
    for (const r of data?.network.regions ?? []) m.set(r.provider, (m.get(r.provider) ?? 0) + 1);
    return m;
  }, [data]);

  if (loadError) {
    return (
      <div className="splash">
        <p>{t('app.loadError', { msg: loadError })}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="splash">
        <div className="spinner" />
        <p>{t('app.loading')}</p>
      </div>
    );
  }

  const onLand = Boolean(sp);
  return (
    <div
      className="app"
      data-stage={stage}
      data-dock={dock}
      style={{ background: theme.background, '--card-w': `${layout.cardW}px`, '--sheet-h': `${layout.sheetPx}px` } as CSSProperties}
    >
      <div className="globe-layer" inert={modal} tabIndex={-1} role="region" aria-label={t('fw.globe')}>
      <GlobeView
        theme={theme}
        countries={data.countries}
        land={data.graph.land}
        cables={data.network.cables}
        showCables={showCables}
        showPlanned={showPlanned}
        regions={ipsOpen ? ipRegions : regions}
        origin={origin}
        you={viewer}
        autoRotate={!origin && !viewer && !ipsOpen && !reduced}
        route={!ipsOpen && tab === 'estimate' ? route : null}
        activeRange={activeRange}
        trace={!ipsOpen && tab !== 'estimate' ? overlay : null}
        traceSource={tab === 'atlas' ? 'atlas' : 'mine'}
        target={ipsOpen ? (ipSel ? regionById.get(ipSel) ?? null : null) : target}
        camera={camera}
        offset={offset}
        reducedMotion={reduced}
        onPick={pick}
        onRegionClick={onRegionClick}
      />
      </div>

      <div className={`hud ${hudHidden ? 'hud-hidden' : ''}`} inert={modal || hudHidden}>
        <h1>
          Net Globe <span>{t('app.title')}</span>
        </h1>
        <p className="hint">{t(stage === 'route' ? 'hud.hintRoute' : origin ? 'hud.hintActive' : 'hud.hintIdle')}</p>
        {viewer && !origin && (
          <p className="you-hint">
            <span className="you-dot" aria-hidden="true" />
            {t('hud.you', { place: viewerLabel(viewer) })}
            <button className="link-button inline" onClick={() => pick(viewer.lat, viewer.lng)}>
              {t('hud.useHere')}
            </button>
          </p>
        )}
        {ipsData && (
          <button className={`ips-link ${ipsOpen ? 'ips-link-on' : ''}`} onClick={() => (ipsOpen ? setIpsOpen(false) : openIps())}>
            <span className="ips-icon" aria-hidden="true" />
            {t('ips.link', { n: ipsData.targets.length })}
          </button>
        )}
        <div className="toolbar">
          <div className="segmented" role="group" aria-label={t('hud.language')}>
            {(['zh', 'en'] as Lang[]).map((l) => (
              <button key={l} aria-pressed={lang === l} className={lang === l ? 'seg-on' : ''} onClick={() => setLang(l)}>
                {l === 'zh' ? '中文' : 'EN'}
              </button>
            ))}
          </div>
          <label className="theme-select">
            <span>{t('hud.theme')}</span>
            <select value={themeId} onChange={(e) => setThemeId(e.target.value as ThemeId)}>
              {THEME_IDS.map((id) => (
                <option key={id} value={id}>
                  {t(THEME_KEY[id])}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="layer-toggles">
          <label>
            <input type="checkbox" checked={showCables} onChange={(e) => setShowCables(e.target.checked)} /> {t('hud.cables')}
          </label>
          <label>
            <input type="checkbox" checked={showPlanned} disabled={!showCables} onChange={(e) => setShowPlanned(e.target.checked)} />{' '}
            {t('hud.planned')}
          </label>
        </div>
        <div className="legend">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              className={`chip ${enabled.has(p.id) ? 'chip-on' : 'chip-off'}`}
              onClick={() => toggleProvider(p.id)}
              title={t(enabled.has(p.id) ? 'hud.hide' : 'hud.show')}
            >
              <span className="dot" style={{ background: p.color }} />
              {providerName(p, lang)}
              <span className="chip-count">{counts.get(p.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <TargetsPanel
        open={ipsOpen}
        data={ipsData}
        regionById={regionById}
        selected={ipSel}
        onSelect={selectIp}
        onClose={() => setIpsOpen(false)}
      />

      <RouteGraphContext value={data.graph}>
      <Panel
        stage={stage}
        layout={layout}
        sheet={sheet}
        origin={origin}
        place={place}
        onLand={onLand}
        enabled={enabled}
        measuredData={measured}
        measuredOrigins={measuredOrigins}
        all={rankedAll}
        target={target}
        tab={tab}
        route={route}
        anchorProbes={data.network.anchorProbes}
        publicTarget={target ? ipsData?.targets.find((x) => x.region === target.id) : undefined}
        owner={owner}
        openFrom={openFrom}
        recent={recent}
        onClose={close}
        onSelect={selectRegion}
        onTab={setTab}
        onMinimize={minimize}
        onRestore={restore}
        onRecenter={recenter}
        onSheet={setSheet}
        onHoverRange={setActiveRange}
        onOverlay={setOverlay}
      />
      </RouteGraphContext>

      <footer className="attribution" inert={modal}>
        {t('footer.cables')} ©{' '}
        <a href="https://www.submarinecablemap.com/" target="_blank" rel="noreferrer">
          TeleGeography
        </a>{' '}
        (CC BY-NC-SA 3.0) · {t('footer.borders')} Natural Earth · {t('footer.measure')}{' '}
        <a href="https://atlas.ripe.net/" target="_blank" rel="noreferrer">
          RIPE Atlas
        </a>{' '}
        / IPmap / RIPEstat · {t('footer.regions')}{' '}
        <a href="https://github.com/jasonwilbur/mcp-server-cloud-regions" target="_blank" rel="noreferrer">
          cloud-regions
        </a>
      </footer>
    </div>
  );
}
