/**
 * 估算 RTT 的经验校准：物理路径模型（estimateRtt）+「路由与排队开销（校准）」。
 *
 * 来源：站长 RIPE Atlas 单次 traceroute（docs/measured.json，2026-10-15 版，含 2026-10-15 00:06 批次），
 * 600 个地区格 × 区域共 6,667 对（每对取各探针最低值，即列表里“实测”显示的数），187 个国家，
 * 中位数回归（对数 L1）。按起点国家分组留一交叉验证（中国按省分组）：
 *   中位绝对误差 15.0 → 11.9 ms，中位 |log(估/测)| 0.477 → 0.298，偏差 −0.44 → 0.00；
 *   同一点击内两两排序一致率 0.715 → 0.730，未测行对实测行的混排一致率 0.718 → 0.788。
 * 国家自助法 95% 区间：k 1.40–1.59，入境 +139–212 ms，出境 +63–77 ms。
 * 每组内对 modelMs 单调不减，且结果 ≥ modelMs（不会低于物理下限）。
 */
export const RTT_CALIBRATION = {
  /** 不跨中国大陆边境的路径：实测 / 模型 的中位比值 */
  k: 1.48,
  /** 起点在中国大陆以外（含港澳台），区域在中国大陆：固定附加 ms（起点国家未知时不加，只乘 k） */
  intoChinaMs: 168,
  /** 起点在中国大陆，区域在中国大陆以外：固定附加 ms（只有到近邻区域的数据，模型 ≤ 42 ms） */
  outOfChinaMs: 72,
} as const;

export interface RttCalibrationInput {
  /** 点击地点所在国家 ISO2（见 places.ts originCountryOf，国界缝隙里的点按附近的国家算）；查不到时为 null */
  originCountry: string | null | undefined;
  /** region.countryCode；'CN' 只指中国大陆，HK/MO/TW 各自独立 */
  regionCountry: string;
}

/** 校准后的估算 RTT（ms）：列表“估算”显示和排序都用它；开销段 = 返回值 − modelMs。 */
/** 用哪条规则：k 乘系数；into 进入中国大陆加固定值；out 从中国大陆出境加固定值。起点国家未知时只乘系数。 */
export function calibrationRule(originCountry: string | null | undefined, regionCountry: string): 'k' | 'into' | 'out' {
  if (originCountry == null) return 'k';
  const fromCN = originCountry === 'CN';
  const toCN = regionCountry === 'CN';
  return toCN && !fromCN ? 'into' : fromCN && !toCN ? 'out' : 'k';
}

export function calibratedRtt(modelMs: number, { originCountry, regionCountry }: RttCalibrationInput): number {
  if (!Number.isFinite(modelMs)) return modelMs;
  const rule = calibrationRule(originCountry, regionCountry);
  const est =
    rule === 'into' ? modelMs + RTT_CALIBRATION.intoChinaMs : rule === 'out' ? modelMs + RTT_CALIBRATION.outOfChinaMs : modelMs * RTT_CALIBRATION.k;
  return Math.max(modelMs, est);
}
