import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GlobeView, { type CameraTarget, type TraceOverlay } from './components/GlobeView.tsx';
import Panel, { type RouteTab } from './components/Panel.tsx';
import type { RankedRegion } from './components/RegionList.tsx';
import { loadAppData, type AppData } from './lib/data.ts';
import { haversineKm, interpolateGreatCircle } from './lib/geo.ts';
import { lookupCountry, lookupPlace, type Place } from './lib/places.ts';
import { PROVIDERS } from './lib/providers.ts';
import { estimateRtt, routeTo, shortestFrom } from './lib/routing.ts';
import type { ProviderId, Region } from './lib/types.ts';
import { useWindowSize } from './lib/useWindowSize.ts';

const PANEL_WIDTH = 440;
const MOBILE_BREAKPOINT = 768;

export default function App() {
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
  const { w, h } = useWindowSize();
  const pickSeq = useRef(0);

  useEffect(() => {
    loadAppData().then(setData, (err: Error) => setLoadError(err.message));
  }, []);

  const sp = useMemo(() => (data && origin ? shortestFrom(data.graph, origin.lat, origin.lng) : null), [data, origin]);

  const regions = useMemo(() => data?.network.regions.filter((r) => enabled.has(r.provider)) ?? [], [data, enabled]);

  const ranked = useMemo<RankedRegion[]>(() => {
    if (!data || !origin) return [];
    return regions
      .map((region) => ({
        region,
        distanceKm: haversineKm(origin.lat, origin.lng, region.lat, region.lng),
        rttMs: estimateRtt(data.graph, sp, region, origin.lat, origin.lng),
      }))
      .sort((a, b) => a.rttMs - b.rttMs);
  }, [data, origin, regions, sp]);

  const route = useMemo(() => (data && sp && target ? routeTo(data.graph, sp, target) : null), [data, sp, target]);

  const pick = useCallback(
    (lat: number, lng: number) => {
      if (!data) return;
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
      if (r && origin) {
        const km = haversineKm(origin.lat, origin.lng, r.lat, r.lng);
        const [lng, lat] = interpolateGreatCircle([origin.lng, origin.lat], [r.lng, r.lat], 0.5);
        setCamera({ lat, lng, altitude: Math.min(3.2, Math.max(1.4, 1.1 + km / 5000)) });
      } else if (origin) {
        setCamera({ ...origin, altitude: 1.9 });
      }
    },
    [origin],
  );

  // URL 深链接：?lat=&lng=&dc=&tab=，便于分享当前视图。
  useEffect(() => {
    if (!data) return;
    const q = new URLSearchParams(window.location.search);
    const lat = Number(q.get('lat'));
    const lng = Number(q.get('lng'));
    if (!q.has('lat') || !q.has('lng') || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    pick(lat, lng);
    const r = data.network.regions.find((x) => x.id === q.get('dc'));
    if (r) {
      setTarget(r);
      setTab(q.get('tab') === 'atlas' ? 'atlas' : 'estimate');
      const km = haversineKm(lat, lng, r.lat, r.lng);
      const [clng, clat] = interpolateGreatCircle([lng, lat], [r.lng, r.lat], 0.5);
      setCamera({ lat: clat, lng: clng, altitude: Math.min(3.2, Math.max(1.4, 1.1 + km / 5000)) });
    }
    // 只在数据首次就绪时读取一次
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const q = new URLSearchParams();
    if (origin) {
      q.set('lat', origin.lat.toFixed(4));
      q.set('lng', origin.lng.toFixed(4));
      if (target) {
        q.set('dc', target.id);
        if (tab === 'atlas') q.set('tab', 'atlas');
      }
    }
    const qs = q.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [data, origin, target, tab]);

  const onRegionClick = useCallback(
    (r: Region) => (origin ? selectRegion(r) : pick(r.lat, r.lng)),
    [origin, selectRegion, pick],
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
      if (target) selectRegion(null);
      else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, selectRegion, close]);

  const mobile = w < MOBILE_BREAKPOINT;
  const offset = useMemo<[number, number]>(
    () => (!origin ? [0, 0] : mobile ? [0, -h * 0.28] : [-PANEL_WIDTH / 2, 0]),
    [origin, mobile, h],
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
        <p>数据加载失败：{loadError}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="splash">
        <div className="spinner" />
        <p>加载海缆、数据中心与地图数据…</p>
      </div>
    );
  }

  const onLand = Boolean(sp);
  return (
    <div className="app">
      <GlobeView
        countries={data.countries}
        cables={data.network.cables}
        showCables={showCables}
        showPlanned={showPlanned}
        regions={regions}
        origin={origin}
        route={tab === 'estimate' ? route : null}
        activeRange={activeRange}
        trace={tab === 'atlas' ? overlay : null}
        target={target}
        camera={camera}
        offset={offset}
        onPick={pick}
        onRegionClick={onRegionClick}
      />

      <div className={`hud ${origin && mobile ? 'hud-hidden' : ''}`}>
        <h1>
          Net Globe <span>云数据中心网络地球</span>
        </h1>
        <p className="hint">{origin ? '点击列表中的数据中心查看路径 · Esc 返回' : '点击地球上任意位置开始'}</p>
        <div className="layer-toggles">
          <label>
            <input type="checkbox" checked={showCables} onChange={(e) => setShowCables(e.target.checked)} /> 海缆
          </label>
          <label>
            <input type="checkbox" checked={showPlanned} disabled={!showCables} onChange={(e) => setShowPlanned(e.target.checked)} /> 规划中海缆
          </label>
        </div>
        <div className="legend">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              className={`chip ${enabled.has(p.id) ? 'chip-on' : 'chip-off'}`}
              onClick={() => toggleProvider(p.id)}
              title={enabled.has(p.id) ? '点击隐藏' : '点击显示'}
            >
              <span className="dot" style={{ background: p.color }} />
              {p.name}
              <span className="chip-count">{counts.get(p.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <Panel
        open={Boolean(origin)}
        origin={origin}
        place={place}
        onLand={onLand}
        ranked={ranked}
        target={target}
        tab={tab}
        route={route}
        anchorProbes={data.network.anchorProbes}
        onClose={close}
        onSelect={selectRegion}
        onTab={setTab}
        onHoverRange={setActiveRange}
        onOverlay={setOverlay}
      />

      <footer className="attribution">
        海缆 ©{' '}
        <a href="https://www.submarinecablemap.com/" target="_blank" rel="noreferrer">
          TeleGeography
        </a>{' '}
        (CC BY-NC-SA 3.0) · 边界 Natural Earth · 测量{' '}
        <a href="https://atlas.ripe.net/" target="_blank" rel="noreferrer">
          RIPE Atlas
        </a>{' '}
        / IPmap / RIPEstat · 区域{' '}
        <a href="https://github.com/jasonwilbur/mcp-server-cloud-regions" target="_blank" rel="noreferrer">
          cloud-regions
        </a>
      </footer>
    </div>
  );
}
