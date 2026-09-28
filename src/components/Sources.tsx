import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import type { RouteTab } from './Panel.tsx';

/** 三类延迟/路由数据：模型估算、站长实测、锚点参考。颜色和名称在列表、tab、说明里保持一致。 */
export type SourceId = RouteTab;

/** 每个数据来源页面顶部的来源说明（同色竖条 + 标题 + 一句话出处）。 */
export function SourceBanner({ source, title, children }: { source: SourceId; title: string; children: ReactNode }) {
  return (
    <div className={`source-banner src-${source}`}>
      <b>{title}</b>
      <p>{children}</p>
    </div>
  );
}

const LEGEND = [
  { id: 'estimate', label: 'tab.estimate', text: 'src.legend.estimate' },
  { id: 'mine', label: 'tab.mine', text: 'src.legend.mine' },
  { id: 'atlas', label: 'tab.atlas', text: 'src.legend.atlas' },
] as const;

/** 列表上方的图例：三类数据各是什么。 */
export function SourceLegend({ note }: { note?: string }) {
  const { t } = useI18n();
  return (
    <div className="source-legend">
      <ul>
        {LEGEND.map((s) => (
          <li key={s.id} className={`src-${s.id}`}>
            <span className="src-swatch" aria-hidden="true" />
            <b>{t(s.label)}</b>
            <span className="muted">{t(s.text)}</span>
          </li>
        ))}
      </ul>
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}
