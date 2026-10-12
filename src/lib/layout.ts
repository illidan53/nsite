// 点击地球后弹出界面的布局：各阶段的面板尺寸、地球偏移，以及把起点→数据中心框进空白区域的镜头。纯函数，便于测试。

import { bearingDeg, haversineKm, interpolateGreatCircle } from './geo.ts';

/** idle 未选点 · overview 居中的选择窗口 · minimized 收起成底部小条 · route 停靠的路线卡 · ips 公开测试 IP 面板。 */
export type Stage = 'idle' | 'overview' | 'minimized' | 'route' | 'ips';
/** 底部路线抽屉的高度：半屏 / 接近全屏。 */
export type Sheet = 'peek' | 'full';

export const MOBILE_BP = 768;
/** 公开测试 IP 面板（仍是右侧抽屉）的宽度。 */
export const IPS_PANEL_W = 440;
/** 手机上选择窗口上方留出的一条地球（显示点击的位置）。 */
export const STRIP = 112;
const GAP = 16;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export interface PlaceLayout {
  mobile: boolean;
  /** 路线卡停靠在右侧，还是从底部弹出（手机、竖屏平板）。 */
  dock: 'side' | 'bottom';
  cardW: number;
  sheetPx: number;
  /** GlobeView 的 globeOffset（负 y 把地球往上推）。 */
  offset: [number, number];
  /** 路线卡之外、用来放路线的空白区域。 */
  free: { w: number; h: number };
}

export function placeLayout(w: number, h: number, stage: Stage, sheet: Sheet): PlaceLayout {
  const mobile = w < MOBILE_BP;
  const dock = !mobile && w / h >= 1.2 ? 'side' : 'bottom';
  const cardW = w >= 1024 ? clamp(Math.round(w * 0.36), 400, 520) : clamp(Math.round(w * 0.45), 340, 400);
  const peekPx = Math.round(clamp(h * 0.44, 300, 480));
  const sheetPx = sheet === 'full' ? Math.round(h * 0.88) : peekPx;
  let offset: [number, number] = [0, 0];
  if (stage === 'ips') offset = mobile ? [0, -h * 0.28] : [-IPS_PANEL_W / 2, 0];
  else if (stage === 'overview' && mobile) offset = [0, -(h / 2 - STRIP / 2)];
  // 抽屉拉到全屏时路线本来就看不见，偏移保持半屏时的位置，避免地球来回跳
  else if (stage === 'route') offset = dock === 'side' ? [-(cardW + GAP) / 2, 0] : [0, -peekPx / 2];
  const free = dock === 'side' ? { w: w - cardW - 3 * GAP, h: h - 2 * GAP } : { w, h: h - peekPx };
  return { mobile, dock, cardW, sheetPx, offset, free };
}

/**
 * 两端都落进空白区域所需的最低镜头高度（地球半径为单位）。
 * 镜头对准大圆中点，两端各偏 θ（半段弧）；透视投影下端点离画面中心 f·sinθ / (D − cosθ) 像素，D = 1 + 高度。
 */
export function fitAltitude(km: number, bearing: number, free: { w: number; h: number }, h: number, fovDeg = 50): number {
  const f = h / 2 / Math.tan((fovDeg * Math.PI) / 360);
  const theta = km / 6371 / 2;
  const b = (bearing * Math.PI) / 180;
  const maxPx = Math.min((0.42 * free.w) / Math.max(Math.abs(Math.sin(b)), 0.2), (0.38 * free.h) / Math.max(Math.abs(Math.cos(b)), 0.2));
  return Math.cos(theta) + (f * Math.sin(theta)) / maxPx - 1;
}

/** 起点 → 数据中心的镜头：对准大圆中点；高度沿用按距离的经验值，空白区域放不下时再拉远（最多 4）。 */
export function routeCamera(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  free: { w: number; h: number },
  h: number,
): { lat: number; lng: number; altitude: number } {
  const km = haversineKm(from.lat, from.lng, to.lat, to.lng);
  const [lng, lat] = interpolateGreatCircle([from.lng, from.lat], [to.lng, to.lat], 0.5);
  const base = clamp(1.1 + km / 5000, 1.4, 3.2);
  const fit = fitAltitude(km, bearingDeg({ lat, lng }, to), free, h);
  return { lat, lng, altitude: Math.max(base, Math.min(fit, 4)) };
}
