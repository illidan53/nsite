import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { MeshPhongMaterial } from 'three';
import { landDots, type LandMask, type LngLat } from '../lib/geo.ts';
import { useI18n } from '../lib/i18n.tsx';
import { endName, providerName, regionName } from '../lib/names.ts';
import { admin1ByCountry, type Admin1Feature, type CountryFeature } from '../lib/places.ts';
import { countryMetrics, expandedCountries, visibleProvinceLabels, type Pov } from '../lib/provinces.ts';
import { PROVIDER_BY_ID } from '../lib/providers.ts';
import type { EstimatedRoute, Segment } from '../lib/routing.ts';
import type { GlobeTheme } from '../lib/themes.ts';
import type { Cable, Region } from '../lib/types.ts';
import { useWindowSize } from '../lib/useWindowSize.ts';

export interface TraceOverlay {
  /** 按顺序排列的地点（探针 → 各跳 → 目标）；同一地点的连续几跳合并成一个，hops 是它们的跳数。 */
  points: { lat: number; lng: number; label: string; kind: 'probe' | 'hop' | 'target'; hops: number[] }[];
  /** 相邻两个地点之间推测的物理路径（陆路或海缆）。 */
  legs: TraceLeg[];
}

export interface TraceLeg {
  coords: LngLat[];
  kind: 'direct' | 'land' | 'sub' | 'unknown';
  label: string;
}

/** 跳数列表显示成“9–11”这样的范围。 */
export function hopRange(hops: number[]) {
  if (!hops.length) return '';
  const lo = Math.min(...hops);
  const hi = Math.max(...hops);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

export interface CameraTarget {
  lat: number;
  lng: number;
  altitude: number;
  /** 过渡时长（ms）。 */
  ms?: number;
}

interface Props {
  theme: GlobeTheme;
  countries: CountryFeature[];
  land: LandMask;
  cables: Cable[];
  showCables: boolean;
  showPlanned: boolean;
  regions: Region[];
  origin: { lat: number; lng: number } | null;
  /** 按访问者 IP 推断的位置。 */
  you: { lat: number; lng: number } | null;
  autoRotate: boolean;
  route: EstimatedRoute | null;
  /** 高亮的分段区间 [起, 止]（含）。 */
  activeRange: [number, number] | null;
  trace: TraceOverlay | null;
  /** 路径来自哪类数据：站长实测（绿）或锚点参考（紫），颜色与面板一致。 */
  traceSource: 'mine' | 'atlas';
  target: Region | null;
  camera: CameraTarget | null;
  offset: [number, number];
  onPick: (lat: number, lng: number) => void;
  onRegionClick: (region: Region) => void;
}

type PathDatum =
  | { type: 'cable'; cable: Cable; coords: LngLat[] }
  | { type: 'route'; seg: Segment; index: number; coords: LngLat[] }
  | { type: 'trace'; leg: TraceLeg; coords: LngLat[] };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const inRange = (i: number, [a, b]: [number, number]) => i >= a && i <= b;

function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// 不依赖状态的访问器放在模块级，保持引用稳定（react-globe.gl 按引用比较 props，变化就会重算整层）。
const polygonSide = () => 'rgba(0,0,0,0)';
const pointLat = (p: LngLat) => p[1];
const pointLng = (p: LngLat) => p[0];
const isRoute = (d: object) => (d as PathDatum).type === 'route';
const isTrace = (d: object) => (d as PathDatum).type === 'trace';
const isCable = (d: object) => (d as PathDatum).type === 'cable';
const pathAlt = (d: object) => (isTrace(d) ? 0.007 : isRoute(d) ? 0.006 : 0.003);
const pathDashLength = (d: object) => (isCable(d) ? 1 : 0.08);
const pathDashGap = (d: object) => (isCable(d) ? 0 : 0.02);
const pathDashAnimate = (d: object) => (isCable(d) ? 0 : 2500);
const pointColor = (d: object) => PROVIDER_BY_ID[(d as Region).provider].color;
/** 实测路径的颜色（与面板里“站长实测”“锚点参考”一致），浅色界面用深一档。 */
const TRACE_COLORS = { mine: { light: '#059669', dark: '#34d399' }, atlas: { light: '#7c3aed', dark: '#a78bfa' } } as const;
const particlesList = (d: object) => d as object[];
const isProvince = (d: object) => 'adm0' in ((d as Admin1Feature).properties ?? {});
const isOutline = (d: object) => 'outline' in d;
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
  const { theme, countries, land, cables, showCables, showPlanned, regions, origin, you, autoRotate, route, activeRange, trace, traceSource, target } =
    props;
  const { camera, offset, onPick, onRegionClick } = props;
  const { lang, t } = useI18n();
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const { w, h } = useWindowSize();

  // ---------------------------------------------------------------- 拉近时展开省级行政区
  const [pov, setPov] = useState<Pov>({ lat: 0, lng: 0, altitude: 2.5 });
  const [admin1, setAdmin1] = useState<Map<string, Admin1Feature[]> | null>(null);
  useEffect(() => {
    admin1ByCountry().then(setAdmin1, () => setAdmin1(new Map()));
  }, []);
  // 旋转、缩放时 onZoom 每帧触发；最多每 250 ms 更新一次视角，停下后再补一次。
  const povTimer = useRef<{ last: number; pending?: ReturnType<typeof setTimeout> }>({ last: 0 });
  const handleZoom = useCallback((p: Pov) => {
    const tm = povTimer.current;
    clearTimeout(tm.pending);
    const apply = () => {
      tm.last = Date.now();
      setPov({ lat: p.lat, lng: p.lng, altitude: p.altitude });
    };
    if (Date.now() - tm.last > 250) apply();
    else tm.pending = setTimeout(apply, 250);
  }, []);
  const metrics = useMemo(() => countryMetrics(countries), [countries]);
  const expandedKey = useMemo(() => expandedCountries(metrics, pov, h).join(','), [metrics, pov, h]);
  const countryByIso = useMemo(() => new Map(countries.map((c) => [c.properties.iso3, c])), [countries]);
  // 展开的国家：原多边形换成只画外轮廓（透明填充），下面铺上各省多边形。对象按国家缓存，保持引用稳定。
  const outlines = useRef(new Map<string, CountryFeature & { outline: true }>());
  const polygons = useMemo(() => {
    const expanded = new Set(expandedKey ? expandedKey.split(',') : []);
    const list: object[] = [];
    for (const c of countries) {
      const iso = c.properties.iso3;
      if (expanded.has(iso) && admin1?.get(iso)?.length) {
        let o = outlines.current.get(iso);
        if (!o) outlines.current.set(iso, (o = { ...c, outline: true }));
        list.push(o);
      } else list.push(c);
    }
    for (const iso of expanded) for (const f of admin1?.get(iso) ?? []) list.push(f);
    return list;
  }, [countries, expandedKey, admin1]);
  const provinceLabels = useRef(new Map<string, { lat: number; lng: number; html: string; cls: string; title: string }>());
  const labels = useMemo(() => {
    if (!expandedKey || !admin1) return [];
    const provinces = expandedKey.split(',').flatMap((iso) => admin1.get(iso) ?? []);
    // 防重叠：按面积从大到小放置，和已放置的标签在屏幕上相交就跳过
    const globe = globeRef.current;
    // 左上角 HUD 和打开的侧边栏所在区域不放省名，避免文字叠在面板上
    const placed: [number, number, number, number][] = [...document.querySelectorAll('.hud > *, .panel-open')].map((el) => {
      const r = el.getBoundingClientRect();
      return [r.left - 4, r.top - 4, r.right + 4, r.bottom + 4];
    });
    const out: { lat: number; lng: number; html: string; cls: string; title: string }[] = [];
    for (const { f, lat, lng } of visibleProvinceLabels(provinces, pov, h)) {
      const name = lang === 'zh' && f.properties.nameZh ? f.properties.nameZh : f.properties.name;
      if (globe) {
        const { x, y } = globe.getScreenCoords(lat, lng, 0.004);
        const halfW = ([...name].reduce((s, ch) => s + (ch.charCodeAt(0) > 0x2e80 ? 11.5 : 6.4), 0) + 8) / 2;
        const box: [number, number, number, number] = [x - halfW, y - 9, x + halfW, y + 9];
        if (box[0] < 0 || box[2] > w || box[1] < 0 || box[3] > h) continue; // 只放完整落在屏幕内的
        if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        placed.push(box);
      }
      const key = `${f.properties.iso}|${lang}|${lat}`;
      let m = provinceLabels.current.get(key);
      if (!m) provinceLabels.current.set(key, (m = { lat, lng, html: name, cls: 'province-label', title: '' }));
      out.push(m);
    }
    return out;
  }, [expandedKey, admin1, pov, w, h, lang]);

  const material = useMemo(
    () => new MeshPhongMaterial({ color: theme.globeColor, emissive: theme.globeEmissive, shininess: theme.shininess }),
    [theme],
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

  const tracePaths = useMemo<PathDatum[]>(
    () => trace?.legs.filter((l) => l.coords.length > 1).map((leg) => ({ type: 'trace' as const, leg, coords: leg.coords })) ?? [],
    [trace],
  );

  const paths = useMemo(() => [...cablePaths, ...routePaths, ...tracePaths], [cablePaths, routePaths, tracePaths]);
  const dimCables = Boolean(route || trace);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.35;
  }, [autoRotate]);

  useEffect(() => {
    if (camera) globeRef.current?.pointOfView(camera, camera.ms ?? 1200);
  }, [camera]);


  const markers = useMemo(() => {
    const list: Marker[] = [];
    if (trace) {
      for (const p of trace.points) {
        list.push({
          lat: p.lat,
          lng: p.lng,
          cls: `marker marker-${p.kind}${p.kind === 'hop' ? ` marker-hop-${traceSource}` : ''}`,
          html: p.kind === 'hop' ? hopRange(p.hops) : p.kind === 'probe' ? 'P' : '◎',
          title: p.label,
        });
      }
    } else if (route) {
      route.segments.forEach((s, i) => {
        if (s.coords.length < 2 || i === 0) return;
        const [lng, lat] = s.coords[0];
        list.push({ lat, lng, cls: 'marker marker-waypoint', html: '', title: endName(s.from, lang, t) });
      });
    }
    if (target) {
      list.push({ lat: target.lat, lng: target.lng, cls: 'marker marker-target', html: '', title: regionName(target, lang) });
    }
    if (you && !origin) {
      list.push({ lat: you.lat, lng: you.lng, cls: 'marker marker-you', html: '', title: t('marker.you') });
    }
    return list;
  }, [trace, traceSource, route, target, you, origin, lang, t]);
  const htmlData = useMemo(() => [...labels, ...markers], [labels, markers]);

  const polygonCap = useCallback((d: object) => (isOutline(d) ? 'rgba(0,0,0,0)' : theme.polygonCap), [theme]);
  const polygonStroke = useCallback((d: object) => (isProvince(d) ? theme.provinceStroke : theme.polygonStroke), [theme]);
  // 省多边形略高于地面，国家外轮廓再高一点，保证国界线画在省界之上。
  const polygonAltitude = useCallback((d: object) => (isOutline(d) ? 0.0026 : isProvince(d) ? 0.0021 : 0.002), []);
  const ringColor = useCallback(() => (x: number) => `rgba(${theme.ring},${1 - x})`, [theme]);

  const polygonLabel = useCallback(
    (d: object) => {
      if (isProvince(d)) {
        const p = (d as Admin1Feature).properties;
        const c = countryByIso.get(p.adm0)?.properties;
        const name = lang === 'zh' && p.nameZh ? p.nameZh : p.name;
        const country = c ? (lang === 'zh' && c.nameZh ? c.nameZh : c.name) : '';
        return `<div class="tip">${esc(name)}<span>${esc(country)}${lang === 'zh' && p.nameZh ? ` · ${esc(p.name)}` : ''}</span></div>`;
      }
      const p = (d as CountryFeature).properties;
      return lang === 'zh'
        ? `<div class="tip">${esc(p.nameZh || p.name)}<span>${esc(p.name)}</span></div>`
        : `<div class="tip">${esc(p.name)}</div>`;
    },
    [lang, countryByIso],
  );
  const pathLabel = useCallback(
    (d: object) => {
      const p = d as PathDatum;
      if (p.type === 'trace') return `<div class="tip">${esc(p.leg.label)}</div>`;
      if (p.type === 'cable') {
        const c = p.cable;
        const status = c.planned ? t('tip.planned') : t('tip.rfs', { year: c.rfsYear ?? '?' });
        return `<div class="tip">${esc(c.name)}<span>${esc(status)}${c.lengthKm ? ` · ${c.lengthKm.toLocaleString()} km` : ''}</span></div>`;
      }
      return `<div class="tip">${esc(endName(p.seg.from, lang, t))} → ${esc(endName(p.seg.to, lang, t))}<span>≈ ${(p.seg.oneWayMs * 2).toFixed(1)} ms RTT</span></div>`;
    },
    [lang, t],
  );
  const pointLabel = useCallback(
    (d: object) => {
      const r = d as Region;
      const p = PROVIDER_BY_ID[r.provider];
      return `<div class="tip"><b style="color:${p.color}">${esc(providerName(p, lang))}</b> ${esc(regionName(r, lang))}<span>${esc(r.code)} · ${esc(r.city)}</span></div>`;
    },
    [lang],
  );

  const pathColor = useCallback(
    (d: object) => {
      const p = d as PathDatum;
      if (p.type === 'cable') return withAlpha(p.cable.color, dimCables ? theme.dimAlpha : p.cable.planned ? theme.plannedAlpha : theme.cableAlpha);
      if (p.type === 'trace') return TRACE_COLORS[traceSource][theme.ui === 'light' ? 'light' : 'dark'];
      const base = p.seg.kind === 'sub' ? theme.routeSub : theme.routeLand;
      if (!activeRange) return base;
      return inRange(p.index, activeRange) ? theme.highlight : withAlpha(base, 0.4);
    },
    [dimCables, activeRange, theme, traceSource],
  );
  const pathStroke = useCallback(
    (d: object) => (isTrace(d) ? 2.4 : isRoute(d) ? (activeRange && inRange((d as { index: number }).index, activeRange) ? 3.2 : 2) : null),
    [activeRange],
  );
  const targetId = target?.id;
  // 拉近时把数据中心柱子按档缩小，避免在省级视角下变成巨大的圆柱
  const pointScale = pov.altitude < 0.25 ? 0.12 : pov.altitude < 0.6 ? 0.3 : pov.altitude < 1.2 ? 0.6 : 1;
  const pointAltitude = useCallback((d: object) => ((d as Region).id === targetId ? 0.08 : 0.025) * pointScale, [targetId, pointScale]);
  const pointRadius = useCallback((d: object) => ((d as Region).id === targetId ? 0.45 : 0.22) * pointScale, [targetId, pointScale]);
  const handleGlobeClick = useCallback(({ lat, lng }: { lat: number; lng: number }) => onPick(lat, lng), [onPick]);
  // 点到国家多边形、点阵或海缆线上时，globe 不会触发 onGlobeClick，这里同样当作选点。
  const handleObjectClick = useCallback(
    (_p: object, _e: MouseEvent, { lat, lng }: { lat: number; lng: number }) => onPick(lat, lng),
    [onPick],
  );
  const handlePointClick = useCallback((d: object) => onRegionClick(d as Region), [onRegionClick]);
  const rings = useMemo(() => (origin ? [origin] : []), [origin]);
  // 点阵：由陆地位图生成，按间距缓存。
  const dotSpacing = theme.dots?.spacing;
  const dots = useMemo(() => (dotSpacing ? [landDots(land, dotSpacing)] : []), [land, dotSpacing]);
  const dotColor = useCallback(() => theme.dots?.color ?? '#ffffff', [theme]);
  const dotSize = useCallback(() => theme.dots?.size ?? 1, [theme]);

  return (
    <Globe
      ref={globeRef}
      width={w}
      height={h}
      globeOffset={offset}
      backgroundColor={theme.background}
      backgroundImageUrl={theme.backgroundImage}
      globeImageUrl={theme.globeImage}
      bumpImageUrl={theme.bumpImage}
      globeMaterial={material}
      showAtmosphere
      atmosphereColor={theme.atmosphere}
      atmosphereAltitude={theme.atmosphereAltitude}
      onGlobeClick={handleGlobeClick}
      onZoom={handleZoom}
      polygonsData={polygons}
      polygonCapColor={polygonCap}
      polygonSideColor={polygonSide}
      polygonStrokeColor={polygonStroke}
      polygonAltitude={polygonAltitude}
      polygonsTransitionDuration={0}
      onPolygonClick={handleObjectClick}
      onPathClick={handleObjectClick}
      polygonLabel={polygonLabel}
      particlesData={dots}
      particlesList={particlesList}
      particleLat="lat"
      particleLng="lng"
      particleAltitude={0.002}
      particlesSize={dotSize}
      particlesSizeAttenuation={false}
      particlesColor={dotColor}
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
      htmlElementsData={htmlData}
      htmlLat="lat"
      htmlLng="lng"
      htmlAltitude={0.01}
      htmlElement={htmlElement}
      htmlTransitionDuration={0}
    />
  );
}

export default memo(GlobeView);
