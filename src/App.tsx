import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GlobeView, { type CameraTarget, type TraceOverlay } from './components/GlobeView.tsx';
import Panel, { type RouteTab } from './components/Panel.tsx';
import TargetsPanel from './components/TargetsPanel.tsx';
import type { RankedRegion } from './components/RegionList.tsx';
import { whoami } from './lib/api.ts';
import { loadAppData, type AppData } from './lib/data.ts';
import { bestRtt, loadMeasured, measuredOriginFor } from './lib/measured.ts';
import { haversineKm, interpolateGreatCircle } from './lib/geo.ts';
import { useI18n, type Lang } from './lib/i18n.tsx';
import { providerName } from './lib/names.ts';
import { lookupCountry, lookupPlace, type Place } from './lib/places.ts';
import { PROVIDERS } from './lib/providers.ts';
import { estimateRtt, routeTo, shortestFrom } from './lib/routing.ts';
import { THEMES, THEME_IDS, initialTheme, saveTheme, type ThemeId } from './lib/themes.ts';
import type { MeasuredData, ProviderId, Region, TargetsData } from './lib/types.ts';
import { useWindowSize } from './lib/useWindowSize.ts';
import { fetchViewerLocation, viewerLabel, type ViewerLocation } from './lib/viewer.ts';

const PANEL_WIDTH = 440;
const MOBILE_BREAKPOINT = 768;
const THEME_KEY = { midnight: 'theme.midnight', night: 'theme.night', marble: 'theme.marble', dots: 'theme.dots', light: 'theme.light' } as const;

function routeCamera(from: { lat: number; lng: number }, to: { lat: number; lng: number }): CameraTarget {
  const km = haversineKm(from.lat, from.lng, to.lat, to.lng);
  const [lng, lat] = interpolateGreatCircle([from.lng, from.lat], [to.lng, to.lat], 0.5);
  return { lat, lng, altitude: Math.min(3.2, Math.max(1.4, 1.1 + km / 5000)) };
}

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
  const { w, h } = useWindowSize();
  const pickSeq = useRef(0);
  const theme = THEMES[themeId];

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
  const measuredOrigin = useMemo(() => measuredOriginFor(measured, place, origin), [measured, place, origin]);

  /** 全部数据中心（不受左上角厂商筛选影响），按估算 RTT 排序；有站长实测时一并带上（两者分开存放，不混算）。 */
  const rankedAll = useMemo<RankedRegion[]>(() => {
    if (!data || !origin) return [];
    return data.network.regions
      .map((region) => ({
        region,
        distanceKm: haversineKm(origin.lat, origin.lng, region.lat, region.lng),
        rttMs: estimateRtt(data.graph, sp, region, origin.lat, origin.lng),
        mineMs: bestRtt(measuredOrigin?.cell.regions[region.id]),
      }))
      .sort((a, b) => a.rttMs - b.rttMs);
  }, [data, origin, sp, measuredOrigin]);
  const nearby = useMemo(() => rankedAll.filter((r) => enabled.has(r.region.provider)), [rankedAll, enabled]);

  const route = useMemo(() => (data && sp && target ? routeTo(data.graph, sp, target) : null), [data, sp, target]);

  const pick = useCallback(
    (lat: number, lng: number) => {
      if (!data) return;
      setIpsOpen(false);
      setOrigin({ lat, lng });
      setTarget(null);
      setOverlay(null);
      setActiveRange(null);
      setPlace({ country: lookupCountry(data.countries, lat, lng), admin1: null });
      setCamera({ lat, lng, altitude: 1.9 });
      const seq = ++pickSeq.current;
      lookupPlace(data.countries, lat, lng).then((p) => {
        if (seq === pickSeq.current) setPlace(p);
      });
    },
    [data],
  );

  const selectRegion = useCallback(
    (r: Region | null) => {
      setTarget(r);
      setOverlay(null);
      setActiveRange(null);
      if (r && origin) setCamera(routeCamera(origin, r));
      else if (origin) setCamera({ ...origin, altitude: 1.9 });
    },
    [origin],
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
        setCamera(routeCamera({ lat, lng }, r));
      }
    }
    fetch('/data/targets.json')
      .then((r) => (r.ok ? (r.json() as Promise<TargetsData>) : null))
      .then((d) => {
        if (!d) return;
        setIpsData(d);
        if (q.has('ips')) {
          setIpsOpen(true);
          const id = q.get('ip');
          const r = id ? data.network.regions.find((x) => x.id === id) : undefined;
          if (r && d.targets.some((x) => x.region === r.id)) {
            setIpSel(r.id);
            setCamera({ lat: r.lat, lng: r.lng, altitude: 1.6 });
          }
        }
      })
      .catch(() => {});
    const ctrl = new AbortController();
    fetchViewerLocation(ctrl.signal).then((v) => {
      if (!v) return;
      setViewer(v);
      if (!deepLink && !q.has('ips')) setCamera({ lat: v.lat, lng: v.lng, altitude: 1.7, ms: 2400 });
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
      if (r) setCamera({ lat: r.lat, lng: r.lng, altitude: 1.6 });
    },
    [regionById],
  );

  const openIps = useCallback(() => {
    setIpsOpen(true);
    setIpSel(null);
  }, []);

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
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (ipsOpen) {
        if (ipSel) setIpSel(null);
        else setIpsOpen(false);
      } else if (target) selectRegion(null);
      else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ipsOpen, ipSel, target, selectRegion, close]);

  const mobile = w < MOBILE_BREAKPOINT;
  const panelOpen = Boolean(origin) || ipsOpen;
  const offset = useMemo<[number, number]>(
    () => (!panelOpen ? [0, 0] : mobile ? [0, -h * 0.28] : [-PANEL_WIDTH / 2, 0]),
    [panelOpen, mobile, h],
  );

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
    <div className="app" style={{ background: theme.background }}>
      <div className="globe-layer">
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
        autoRotate={!origin && !viewer && !ipsOpen}
        route={!ipsOpen && tab === 'estimate' ? route : null}
        activeRange={activeRange}
        trace={!ipsOpen && tab !== 'estimate' ? overlay : null}
        traceSource={tab === 'atlas' ? 'atlas' : 'mine'}
        target={ipsOpen ? (ipSel ? regionById.get(ipSel) ?? null : null) : target}
        camera={camera}
        offset={offset}
        onPick={pick}
        onRegionClick={onRegionClick}
      />
      </div>

      <div className={`hud ${panelOpen && mobile ? 'hud-hidden' : ''}`}>
        <h1>
          Net Globe <span>{t('app.title')}</span>
        </h1>
        <p className="hint">{t(origin ? 'hud.hintActive' : 'hud.hintIdle')}</p>
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

      <Panel
        open={Boolean(origin) && !ipsOpen}
        origin={origin}
        place={place}
        onLand={onLand}
        nearby={nearby}
        measuredData={measured}
        measuredOrigin={measuredOrigin}
        all={rankedAll}
        target={target}
        tab={tab}
        route={route}
        anchorProbes={data.network.anchorProbes}
        publicTarget={target ? ipsData?.targets.find((x) => x.region === target.id) : undefined}
        owner={owner}
        onClose={close}
        onSelect={selectRegion}
        onTab={setTab}
        onHoverRange={setActiveRange}
        onOverlay={setOverlay}
      />

      <footer className="attribution">
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
