// 柯本气候分类：Beck et al. (2023) 1991–2020 年版，降采样到 0.25° 的 uint8 网格（见 scripts/build-data.ts）。

export interface KoppenClass {
  code: string;
  zh: string;
  en: string;
}

const W = 1440;
const H = 720;
const RES = 4; // 每度格数

const CLASSES: [string, string, string][] = [
  ['Af', '热带雨林气候', 'Tropical rainforest'],
  ['Am', '热带季风气候', 'Tropical monsoon'],
  ['Aw', '热带草原气候', 'Tropical savanna'],
  ['BWh', '热带沙漠气候', 'Hot desert'],
  ['BWk', '温带沙漠气候', 'Cold desert'],
  ['BSh', '热带半干旱气候', 'Hot semi-arid'],
  ['BSk', '温带半干旱气候', 'Cold semi-arid'],
  ['Csa', '地中海气候（夏季炎热）', 'Hot-summer Mediterranean'],
  ['Csb', '地中海气候（夏季温和）', 'Warm-summer Mediterranean'],
  ['Csc', '地中海气候（夏季凉爽）', 'Cold-summer Mediterranean'],
  ['Cwa', '亚热带季风气候', 'Monsoon-influenced humid subtropical'],
  ['Cwb', '亚热带高原气候', 'Subtropical highland'],
  ['Cwc', '亚热带高原气候（夏季凉爽）', 'Cold subtropical highland'],
  ['Cfa', '湿润亚热带气候', 'Humid subtropical'],
  ['Cfb', '温带海洋性气候', 'Temperate oceanic'],
  ['Cfc', '亚寒带海洋性气候', 'Subpolar oceanic'],
  ['Dsa', '夏干大陆性气候（夏季炎热）', 'Hot-summer continental, dry summer'],
  ['Dsb', '夏干大陆性气候（夏季温和）', 'Warm-summer continental, dry summer'],
  ['Dsc', '夏干亚寒带气候', 'Subarctic, dry summer'],
  ['Dsd', '夏干亚寒带气候（冬季严寒）', 'Extremely cold subarctic, dry summer'],
  ['Dwa', '温带季风气候（夏季炎热）', 'Monsoon-influenced hot-summer continental'],
  ['Dwb', '温带季风气候（夏季温和）', 'Monsoon-influenced warm-summer continental'],
  ['Dwc', '亚寒带季风气候', 'Monsoon-influenced subarctic'],
  ['Dwd', '亚寒带季风气候（冬季严寒）', 'Monsoon-influenced extremely cold subarctic'],
  ['Dfa', '湿润大陆性气候（夏季炎热）', 'Hot-summer humid continental'],
  ['Dfb', '湿润大陆性气候（夏季温和）', 'Warm-summer humid continental'],
  ['Dfc', '亚寒带气候', 'Subarctic'],
  ['Dfd', '亚寒带气候（冬季严寒）', 'Extremely cold subarctic'],
  ['ET', '苔原气候', 'Tundra'],
  ['EF', '冰原气候', 'Ice cap'],
];

let grid: Promise<Uint8Array> | null = null;

function loadGrid() {
  grid ??= fetch('/data/koppen.bin')
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.arrayBuffer();
    })
    .then((b) => new Uint8Array(b))
    .catch((err) => {
      grid = null;
      throw err;
    });
  return grid;
}

/** 按网格查某点的柯本类别索引（1–30）；落在海上（0）时就近找 1–3 格内的陆地。 */
export function koppenIndex(cells: Uint8Array, lat: number, lng: number): number {
  const r0 = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) * RES)));
  const c0 = Math.floor((lng + 180) * RES);
  const at = (r: number, c: number) => (r < 0 || r >= H ? 0 : cells[r * W + (((c % W) + W) % W)]);
  if (at(r0, c0)) return at(r0, c0);
  for (let d = 1; d <= 3; d++) {
    for (let dr = -d; dr <= d; dr++) {
      for (let dc = -d; dc <= d; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== d) continue;
        const v = at(r0 + dr, c0 + dc);
        if (v) return v;
      }
    }
  }
  return 0;
}

export async function koppenAt(lat: number, lng: number): Promise<KoppenClass | null> {
  const i = koppenIndex(await loadGrid(), lat, lng);
  const c = CLASSES[i - 1];
  return c ? { code: c[0], zh: c[1], en: c[2] } : null;
}
