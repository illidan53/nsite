// 拉近时展开省级行政区：按每个国家在屏幕上的大小决定是否展开，大国稍微拉近就展开，小国要拉得更近。

import { geoArea, geoCentroid, geoDistance } from 'd3-geo';
import type { Admin1Feature, CountryFeature } from './places.ts';

const EARTH_RADIUS_KM = 6371.0088;
/** 国家在屏幕上的“直径”超过这么多像素时展开省界。 */
export const EXPAND_MIN_PX = 260;
/** 省在屏幕上的“直径”超过这么多像素时显示省名。 */
export const LABEL_MIN_PX = 36;
/** 同时展开的国家数上限（拉近欧洲等小国密集区时防止过载）。 */
export const MAX_EXPANDED = 12;

export interface Pov {
  lat: number;
  lng: number;
  altitude: number;
}

export interface CountryMetric {
  iso3: string;
  lng: number;
  lat: number;
  /** 与国家面积相同的球冠直径（弧度）。 */
  diamRad: number;
}

/** 面积（球面度）换算成等面积圆的直径（弧度）。 */
const diameterFromArea = (steradians: number) => 2 * Math.sqrt(steradians / Math.PI);

export function countryMetrics(countries: CountryFeature[]): CountryMetric[] {
  return countries.map((f) => {
    let area = geoArea(f);
    if (area > 2 * Math.PI) area = 4 * Math.PI - area; // 环绕方向反了时 d3 会算成补集
    const [lng, lat] = geoCentroid(f);
    return { iso3: f.properties.iso3, lng, lat, diamRad: diameterFromArea(area) };
  });
}

/**
 * 屏幕上的近似像素尺寸：镜头离地面 altitude × 地球半径，透视投影下
 * 角尺寸 θ 的弧在屏幕上约为 θ / altitude × 视口高度 / (2 tan(fov/2))。
 */
export function pixelSize(angularRad: number, altitude: number, viewportH: number, fovDeg = 50): number {
  return (angularRad * viewportH) / (2 * Math.tan((fovDeg * Math.PI) / 360) * Math.max(altitude, 0.01));
}

/** 从镜头正下方到地平线的角距离（弧度）。 */
export const visibleRadius = (altitude: number) => Math.acos(1 / (1 + altitude));

/** 应展开省界的国家（ADM0_A3），按离视野中心的距离排序。 */
export function expandedCountries(metrics: CountryMetric[], pov: Pov, viewportH: number): string[] {
  const center: [number, number] = [pov.lng, pov.lat];
  // 只看视野中心附近：贴着地平线的国家即使很大也不展开
  const reach = visibleRadius(pov.altitude) * 0.55;
  return metrics
    .map((m) => ({ m, d: geoDistance(center, [m.lng, m.lat]) }))
    .filter(({ m, d }) => d < reach && pixelSize(m.diamRad, pov.altitude, viewportH) >= EXPAND_MIN_PX)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_EXPANDED)
    .map(({ m }) => m.iso3)
    .sort();
}

/** 在当前视角下足够大、且在可见范围内的省，返回其标注点。 */
export function visibleProvinceLabels(
  provinces: Admin1Feature[],
  pov: Pov,
  viewportH: number,
): { f: Admin1Feature; lat: number; lng: number }[] {
  const center: [number, number] = [pov.lng, pov.lat];
  const reach = visibleRadius(pov.altitude) * 0.7;
  const out: { f: Admin1Feature; lat: number; lng: number }[] = [];
  for (const f of provinces) {
    const { area, labelLat, labelLng } = f.properties;
    if (!area || labelLat === null || labelLng === null) continue;
    const diam = diameterFromArea(area / EARTH_RADIUS_KM ** 2);
    if (pixelSize(diam, pov.altitude, viewportH) < LABEL_MIN_PX) continue;
    if (geoDistance(center, [labelLng, labelLat]) > reach) continue;
    out.push({ f, lat: labelLat, lng: labelLng });
  }
  // 面积大的优先，便于调用方做防重叠时先放大省
  return out.sort((a, b) => (b.f.properties.area ?? 0) - (a.f.properties.area ?? 0));
}
