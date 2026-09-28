// 浏览器与 scripts/build-data.ts 共用的地理计算。保持无依赖，便于 Node 直接运行。

export type LngLat = [number, number];

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 折线（[lng, lat] 序列）的大圆长度。 */
export function polylineKm(coords: LngLat[]): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    km += haversineKm(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return km;
}

/** 大圆插值，t ∈ [0, 1]。返回 [lng, lat]。 */
export function interpolateGreatCircle(a: LngLat, b: LngLat, t: number): LngLat {
  const [lng1, lat1] = [toRad(a[0]), toRad(a[1])];
  const [lng2, lat2] = [toRad(b[0]), toRad(b[1])];
  const d =
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin((lat2 - lat1) / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2,
        ),
      ),
    );
  if (d === 0) return a;
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
  const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  return [toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))];
}

/** 按固定步长（km）沿大圆取点，用于画线和陆地判断。包含两端点。 */
export function greatCirclePoints(a: LngLat, b: LngLat, stepKm: number): LngLat[] {
  const km = haversineKm(a[1], a[0], b[1], b[0]);
  const n = Math.max(1, Math.ceil(km / stepKm));
  const pts: LngLat[] = [];
  for (let i = 0; i <= n; i++) pts.push(interpolateGreatCircle(a, b, i / n));
  return pts;
}

/**
 * 0.1° 分辨率的陆地位图（1 bit/格，行从北到南）。
 * 由 build-data 从 Natural Earth land 多边形栅格化生成。
 */
export class LandMask {
  static readonly RES = 10; // 每度格数
  static readonly W = 360 * LandMask.RES;
  static readonly H = 180 * LandMask.RES;
  readonly bits: Uint8Array;

  constructor(bits?: Uint8Array) {
    this.bits = bits ?? new Uint8Array(Math.ceil((LandMask.W * LandMask.H) / 8));
  }

  private index(lng: number, lat: number): number {
    let col = Math.floor((lng + 180) * LandMask.RES);
    let row = Math.floor((90 - lat) * LandMask.RES);
    col = ((col % LandMask.W) + LandMask.W) % LandMask.W;
    row = Math.min(LandMask.H - 1, Math.max(0, row));
    return row * LandMask.W + col;
  }

  set(row: number, col: number) {
    const i = row * LandMask.W + col;
    this.bits[i >> 3] |= 1 << (i & 7);
  }

  isLand(lng: number, lat: number): boolean {
    const i = this.index(lng, lat);
    return (this.bits[i >> 3] & (1 << (i & 7))) !== 0;
  }

  /** 距离 radiusKm 内是否有陆地格（用于容忍海岸线栅格误差）。 */
  nearLand(lng: number, lat: number, radiusKm: number): boolean {
    if (this.isLand(lng, lat)) return true;
    const stepDeg = 1 / LandMask.RES;
    const dLat = radiusKm / 111;
    const dLng = radiusKm / (111 * Math.max(0.1, Math.cos(toRad(lat))));
    for (let y = -dLat; y <= dLat; y += stepDeg) {
      for (let x = -dLng; x <= dLng; x += stepDeg) {
        if (this.isLand(lng + x, lat + y)) return true;
      }
    }
    return false;
  }

  /**
   * 两点之间的大圆路径是否基本在陆地上（陆地光缆可行）。
   * 两端各 endSlackKm 内不检查（登陆站在海岸线上，栅格化后可能落在海里），
   * 中间允许连续不超过 maxWaterKm 的水面（河流、海峡栅格误差）。
   */
  overlandPath(a: LngLat, b: LngLat, endSlackKm = 25, maxWaterKm = 25, stepKm = 10): boolean {
    const total = haversineKm(a[1], a[0], b[1], b[0]);
    if (total <= endSlackKm * 2) return true;
    const pts = greatCirclePoints(a, b, stepKm);
    const step = total / (pts.length - 1);
    let water = 0;
    for (let i = 0; i < pts.length; i++) {
      const along = i * step;
      if (along < endSlackKm || total - along < endSlackKm) continue;
      if (this.isLand(pts[i][0], pts[i][1])) {
        water = 0;
      } else {
        water += step;
        if (water > maxWaterKm) return false;
      }
    }
    return true;
  }
}

/**
 * 陆地上近似等面积分布的点（纬度每 stepDeg 一行，经度间距按 1/cos(纬度) 放大）。
 * 用于“点阵”视觉方案。不含南极洲（贴在球体边缘时会糊成一圈）。
 */
export function landDots(mask: LandMask, stepDeg: number): { lat: number; lng: number }[] {
  const dots: { lat: number; lng: number }[] = [];
  for (let lat = -58; lat <= 84; lat += stepDeg) {
    const step = stepDeg / Math.max(0.15, Math.cos(toRad(lat)));
    const offset = (Math.round(lat / stepDeg) % 2) * step * 0.5;
    for (let lng = -180 + offset; lng < 180; lng += step) {
      if (mask.isLand(lng, lat)) dots.push({ lat, lng });
    }
  }
  return dots;
}

