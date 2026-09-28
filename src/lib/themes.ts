// 地球视觉方案。界面（HUD、面板）只分深色、浅色两套，由 ui 字段决定。

export type ThemeId = 'midnight' | 'night' | 'marble' | 'dots' | 'light';

export interface GlobeTheme {
  id: ThemeId;
  ui: 'dark' | 'light';
  background: string;
  backgroundImage: string | null;
  globeImage: string | null;
  bumpImage: string | null;
  /** 球体材质颜色；有贴图时应为白色，否则会给贴图染色。 */
  globeColor: string;
  globeEmissive: string;
  shininess: number;
  atmosphere: string;
  atmosphereAltitude: number;
  polygonCap: string;
  polygonStroke: string;
  /** 陆地点阵：点间距（度）、像素大小、颜色。 */
  dots: { color: string; spacing: number; size: number } | null;
  cableAlpha: number;
  plannedAlpha: number;
  dimAlpha: number;
  routeSub: string;
  routeLand: string;
  highlight: string;
  ring: string;
}

const TEX = '/data/textures';

export const THEMES: Record<ThemeId, GlobeTheme> = {
  midnight: {
    id: 'midnight',
    ui: 'dark',
    background: '#03060c',
    backgroundImage: null,
    globeImage: null,
    bumpImage: null,
    globeColor: '#0b1a2e',
    globeEmissive: '#040a14',
    shininess: 6,
    atmosphere: '#4a8cff',
    atmosphereAltitude: 0.16,
    polygonCap: 'rgba(52, 78, 112, 0.55)',
    polygonStroke: 'rgba(140, 170, 210, 0.35)',
    dots: null,
    cableAlpha: 0.75,
    plannedAlpha: 0.35,
    dimAlpha: 0.18,
    routeSub: '#38bdf8',
    routeLand: '#fbbf24',
    highlight: '#ffffff',
    ring: '255,255,255',
  },
  night: {
    id: 'night',
    ui: 'dark',
    background: '#000000',
    backgroundImage: `${TEX}/night-sky.png`,
    globeImage: `${TEX}/earth-night.jpg`,
    bumpImage: null,
    globeColor: '#ffffff',
    globeEmissive: '#000000',
    shininess: 4,
    atmosphere: '#6fa8ff',
    atmosphereAltitude: 0.18,
    polygonCap: 'rgba(0, 0, 0, 0)',
    polygonStroke: 'rgba(255, 255, 255, 0.10)',
    dots: null,
    cableAlpha: 0.7,
    plannedAlpha: 0.3,
    dimAlpha: 0.15,
    routeSub: '#5eead4',
    routeLand: '#fde047',
    highlight: '#ffffff',
    ring: '255,255,255',
  },
  marble: {
    id: 'marble',
    ui: 'dark',
    background: '#000000',
    backgroundImage: `${TEX}/night-sky.png`,
    globeImage: `${TEX}/earth-blue-marble.jpg`,
    bumpImage: `${TEX}/earth-topology.png`,
    globeColor: '#ffffff',
    globeEmissive: '#000000',
    shininess: 10,
    atmosphere: '#8ab8ff',
    atmosphereAltitude: 0.2,
    polygonCap: 'rgba(0, 0, 0, 0)',
    polygonStroke: 'rgba(255, 255, 255, 0.22)',
    dots: null,
    cableAlpha: 0.85,
    plannedAlpha: 0.35,
    dimAlpha: 0.2,
    routeSub: '#22d3ee',
    routeLand: '#facc15',
    highlight: '#ffffff',
    ring: '255,255,255',
  },
  dots: {
    id: 'dots',
    ui: 'dark',
    background: '#05070f',
    backgroundImage: null,
    globeImage: null,
    bumpImage: null,
    globeColor: '#070c18',
    globeEmissive: '#03060d',
    shininess: 2,
    atmosphere: '#3f6ad8',
    atmosphereAltitude: 0.14,
    polygonCap: 'rgba(0, 0, 0, 0)',
    polygonStroke: 'rgba(0, 0, 0, 0)',
    dots: { color: '#5f8bd0', spacing: 0.9, size: 2.2 },
    cableAlpha: 0.6,
    plannedAlpha: 0.25,
    dimAlpha: 0.14,
    routeSub: '#38bdf8',
    routeLand: '#f59e0b',
    highlight: '#ffffff',
    ring: '255,255,255',
  },
  light: {
    id: 'light',
    ui: 'light',
    background: '#e8edf4',
    backgroundImage: null,
    globeImage: null,
    bumpImage: null,
    globeColor: '#ffffff',
    globeEmissive: '#d9e3f0',
    shininess: 0,
    atmosphere: '#9bbbe8',
    atmosphereAltitude: 0.12,
    polygonCap: 'rgba(196, 208, 224, 0.95)',
    polygonStroke: 'rgba(120, 138, 164, 0.6)',
    dots: null,
    cableAlpha: 0.9,
    plannedAlpha: 0.4,
    dimAlpha: 0.22,
    routeSub: '#0369a1',
    routeLand: '#c2410c',
    highlight: '#0f172a',
    ring: '15,23,42',
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

const STORAGE_KEY = 'nsite-theme';

export function initialTheme(): ThemeId {
  const q = new URLSearchParams(window.location.search).get('theme');
  if (q && q in THEMES) return q as ThemeId;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in THEMES) return saved as ThemeId;
  } catch {
    // 忽略
  }
  return 'light';
}

export function saveTheme(id: ThemeId) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 忽略
  }
}
