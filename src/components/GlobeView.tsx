import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { MeshPhongMaterial } from 'three';
import type { LngLat } from '../lib/geo.ts';
import type { CountryFeature } from '../lib/places.ts';
import { PROVIDER_BY_ID } from '../lib/providers.ts';
import type { EstimatedRoute, Segment } from '../lib/routing.ts';
import type { Cable, Region } from '../lib/types.ts';
import { useWindowSize } from '../lib/useWindowSize.ts';

export interface TraceOverlay {
  /** 按顺序排列的已定位节点（探针 → 各跳 → 目标）。 */
  points: { lat: number; lng: number; label: string; kind: 'probe' | 'hop' | 'target'; hop?: number }[];
}

export interface CameraTarget {
  lat: number;
  lng: number;
  altitude: number;
}

interface Props {
  countries: CountryFeature[];
  cables: Cable[];
  showCables: boolean;
  showPlanned: boolean;
  regions: Region[];
  origin: { lat: number; lng: number } | null;
  route: EstimatedRoute | null;
  /** 高亮的分段区间 [起, 止]（含）。 */
  activeRange: [number, number] | null;
  trace: TraceOverlay | null;
  target: Region | null;
  camera: CameraTarget | null;
  offset: [number, number];
  onPick: (lat: number, lng: number) => void;
  onRegionClick: (region: Region) => void;
}

type PathDatum =
  | { type: 'cable'; cable: Cable; coords: LngLat[] }
  | { type: 'route'; seg: Segment; index: number; coords: LngLat[] };

const SUB_COLOR = '#38bdf8';
const LAND_COLOR = '#fbbf24';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const inRange = (i: number, [a, b]: [number, number]) => i >= a && i <= b;

function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// 不依赖状态的访问器放在模块级，保持引用稳定（react-globe.gl 按引用比较 props，变化就会重算整层）。
const polygonCap = () => 'rgba(52, 78, 112, 0.55)';
const polygonSide = () => 'rgba(0,0,0,0)';
const polygonStroke = () => 'rgba(140, 170, 210, 0.35)';
const polygonLabel = (d: object) => {
  const p = (d as CountryFeature).properties;
  return `<div class="tip">${esc(p.nameZh || p.name)}<span>${esc(p.name)}</span></div>`;
};
const pointLat = (p: LngLat) => p[1];
const pointLng = (p: LngLat) => p[0];
const isRoute = (d: object) => (d as PathDatum).type === 'route';
const pathAlt = (d: object) => (isRoute(d) ? 0.006 : 0.003);
const pathDashLength = (d: object) => (isRoute(d) ? 0.08 : 1);
const pathDashGap = (d: object) => (isRoute(d) ? 0.02 : 0);
const pathDashAnimate = (d: object) => (isRoute(d) ? 2500 : 0);
const pathLabel = (d: object) => {
  const p = d as PathDatum;
  if (p.type === 'cable') {
    const c = p.cable;
    return `<div class="tip">${esc(c.name)}<span>${c.planned ? '规划中' : `投产 ${c.rfsYear ?? '?'}`}${c.lengthKm ? ` · ${c.lengthKm.toLocaleString()} km` : ''}</span></div>`;
  }
  return `<div class="tip">${esc(p.seg.from)} → ${esc(p.seg.to)}<span>约 ${(p.seg.oneWayMs * 2).toFixed(1)} ms RTT</span></div>`;
};
const pointColor = (d: object) => PROVIDER_BY_ID[(d as Region).provider].color;
const pointLabel = (d: object) => {
  const r = d as Region;
  const p = PROVIDER_BY_ID[r.provider];
  return `<div class="tip"><b style="color:${p.color}">${esc(p.name)}</b> ${esc(r.name)}<span>${esc(r.code)} · ${esc(r.city)}</span></div>`;
};
const ringColor = () => (t: number) => `rgba(255,255,255,${1 - t})`;
type Arc = { from: { lat: number; lng: number }; to: { lat: number; lng: number } };
const arcStartLat = (d: object) => (d as Arc).from.lat;
const arcStartLng = (d: object) => (d as Arc).from.lng;
const arcEndLat = (d: object) => (d as Arc).to.lat;
const arcEndLng = (d: object) => (d as Arc).to.lng;
const arcColor = () => ['#f472b6', '#a78bfa'];
type Marker = { lat: number; lng: number; html: string; cls: string; title: string };
const htmlElement = (d: object) => {
  const m = d as Marker;
  const el = document.createElement('div');
  el.className = m.cls;
  el.textContent = m.html;
  el.title = m.title;
  return el;
};

function GlobeView(props: Props) {
  const { countries, cables, showCables, showPlanned, regions, origin, route, activeRange, trace, target, camera, offset, onPick, onRegionClick } =
    props;
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const { w, h } = useWindowSize();

  const material = useMemo(
    () => new MeshPhongMaterial({ color: '#0b1a2e', emissive: '#040a14', shininess: 6 }),
    [],
  );

  // 海缆路径只随开关变化，避免每次选路都重建上千条线。
  const cablePaths = useMemo<PathDatum[]>(() => {
    if (!showCables) return [];
    return cables
      .filter((c) => showPlanned || !c.planned)
      .flatMap((c) => c.lines.map((coords) => ({ type: 'cable' as const, cable: c, coords })));
  }, [cables, showCables, showPlanned]);

  const routePaths = useMemo<PathDatum[]>(
    () =>
      route?.segments
        .map((seg, index) => ({ type: 'route' as const, seg, index, coords: seg.coords }))
        .filter((p) => p.coords.length > 1) ?? [],
    [route],
  );

  const paths = useMemo(() => [...cablePaths, ...routePaths], [cablePaths, routePaths]);
  const dimCables = Boolean(route || trace);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = !origin;
    controls.autoRotateSpeed = 0.35;
  }, [origin]);

  useEffect(() => {
    if (camera) globeRef.current?.pointOfView(camera, 1200);
  }, [camera]);

  const arcs = useMemo(() => {
    if (!trace) return [];
    const pts = trace.points;
    return pts.slice(1).map((p, i): Arc => ({ from: pts[i], to: p }));
  }, [trace]);

  const markers = useMemo(() => {
    const list: Marker[] = [];
    if (trace) {
      for (const p of trace.points) {
        list.push({
          lat: p.lat,
          lng: p.lng,
          cls: `marker marker-${p.kind}`,
          html: p.kind === 'hop' ? String(p.hop) : p.kind === 'probe' ? 'P' : '◎',
          title: p.label,
        });
      }
    } else if (route) {
      route.segments.forEach((s, i) => {
        if (s.coords.length < 2 || i === 0) return;
        const [lng, lat] = s.coords[0];
        list.push({ lat, lng, cls: 'marker marker-waypoint', html: '', title: s.from });
      });
    }
    if (target) {
      list.push({ lat: target.lat, lng: target.lng, cls: 'marker marker-target', html: '', title: target.name });
    }
    return list;
  }, [trace, route, target]);

  const pathColor = useCallback(
    (d: object) => {
      const p = d as PathDatum;
      if (p.type === 'cable') return withAlpha(p.cable.color, dimCables ? 0.18 : p.cable.planned ? 0.35 : 0.75);
      const base = p.seg.kind === 'sub' ? SUB_COLOR : LAND_COLOR;
      if (!activeRange) return base;
      return inRange(p.index, activeRange) ? '#ffffff' : withAlpha(base, 0.4);
    },
    [dimCables, activeRange],
  );
  const pathStroke = useCallback(
    (d: object) => (isRoute(d) ? (activeRange && inRange((d as { index: number }).index, activeRange) ? 3.2 : 2) : null),
    [activeRange],
  );
  const targetId = target?.id;
  const pointAltitude = useCallback((d: object) => ((d as Region).id === targetId ? 0.08 : 0.025), [targetId]);
  const pointRadius = useCallback((d: object) => ((d as Region).id === targetId ? 0.45 : 0.22), [targetId]);
  const handleGlobeClick = useCallback(({ lat, lng }: { lat: number; lng: number }) => onPick(lat, lng), [onPick]);
  // 点到国家多边形或海缆线上时，globe 不会触发 onGlobeClick，这里同样当作选点。
  const handlePolygonClick = useCallback(
    (_p: object, _e: MouseEvent, { lat, lng }: { lat: number; lng: number }) => onPick(lat, lng),
    [onPick],
  );
  const handlePointClick = useCallback((d: object) => onRegionClick(d as Region), [onRegionClick]);
  const rings = useMemo(() => (origin ? [origin] : []), [origin]);

  return (
    <Globe
      ref={globeRef}
      width={w}
      height={h}
      globeOffset={offset}
      backgroundColor="#03060c"
      globeMaterial={material}
      showAtmosphere
      atmosphereColor="#4a8cff"
      atmosphereAltitude={0.16}
      onGlobeClick={handleGlobeClick}
      polygonsData={countries}
      polygonCapColor={polygonCap}
      polygonSideColor={polygonSide}
      polygonStrokeColor={polygonStroke}
      polygonAltitude={0.002}
      polygonsTransitionDuration={0}
      onPolygonClick={handlePolygonClick}
      onPathClick={handlePolygonClick}
      polygonLabel={polygonLabel}
      pathsData={paths}
      pathPoints="coords"
      pathPointLat={pointLat}
      pathPointLng={pointLng}
      pathPointAlt={pathAlt}
      pathTransitionDuration={0}
      pathColor={pathColor}
      pathStroke={pathStroke}
      pathDashLength={pathDashLength}
      pathDashGap={pathDashGap}
      pathDashAnimateTime={pathDashAnimate}
      pathLabel={pathLabel}
      pointsData={regions}
      pointLat="lat"
      pointLng="lng"
      pointColor={pointColor}
      pointAltitude={pointAltitude}
      pointRadius={pointRadius}
      pointsTransitionDuration={300}
      pointLabel={pointLabel}
      onPointClick={handlePointClick}
      ringsData={rings}
      ringLat="lat"
      ringLng="lng"
      ringColor={ringColor}
      ringMaxRadius={2.5}
      ringPropagationSpeed={2}
      ringRepeatPeriod={900}
      arcsData={arcs}
      arcStartLat={arcStartLat}
      arcStartLng={arcStartLng}
      arcEndLat={arcEndLat}
      arcEndLng={arcEndLng}
      arcColor={arcColor}
      arcStroke={0.5}
      arcAltitudeAutoScale={0.35}
      arcDashLength={0.5}
      arcDashGap={0.15}
      arcDashAnimateTime={1800}
      arcsTransitionDuration={0}
      htmlElementsData={markers}
      htmlLat="lat"
      htmlLng="lng"
      htmlAltitude={0.01}
      htmlElement={htmlElement}
      htmlTransitionDuration={0}
    />
  );
}

export default memo(GlobeView);
