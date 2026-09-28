// 按当前语言显示区域、厂商、路径节点的名字。

import type { Lang, Translate } from './i18n.tsx';
import type { ProviderInfo } from './providers.ts';
import type { SegmentEnd } from './routing.ts';
import type { Region } from './types.ts';

export const regionName = (r: Region, lang: Lang) => (lang === 'zh' && r.nameZh ? r.nameZh : r.name);

export const providerName = (p: ProviderInfo, lang: Lang) => (lang === 'zh' && p.nameZh ? p.nameZh : p.name);

export function endName(e: SegmentEnd | null, lang: Lang, t: Translate): string {
  if (!e) return '';
  switch (e.kind) {
    case 'origin':
      return t('est.origin');
    case 'dc': {
      const name = lang === 'zh' && e.nameZh ? e.nameZh : e.name;
      return e.code ? `${name} (${e.code})` : name;
    }
    case 'city':
      return lang === 'zh' && e.nameZh ? `${e.nameZh}（${e.name}）` : e.name;
    default:
      return e.name;
  }
}
