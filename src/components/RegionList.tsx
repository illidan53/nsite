import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import { providerName, regionName } from '../lib/names.ts';
import { PROVIDERS, PROVIDER_BY_ID } from '../lib/providers.ts';
import type { ProviderId, Region } from '../lib/types.ts';

export interface RankedRegion {
  region: Region;
  distanceKm: number;
  /** 模型估算 RTT。 */
  rttMs: number;
  /** 站长实测（批量）里到达该区域的最低 RTT；没有测过或没到达时为 null。 */
  mineMs: number | null;
}

export function fmtMs(ms: number) {
  return Math.abs(ms) < 10 ? ms.toFixed(1) : Math.round(ms).toString();
}

export function fmtKm(km: number) {
  return km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString();
}

function RegionRow({ item, max, onSelect }: { item: RankedRegion; max: number; onSelect: (r: Region) => void }) {
  const { lang, t } = useI18n();
  const { region, distanceKm, rttMs, mineMs } = item;
  const p = PROVIDER_BY_ID[region.provider];
  const same = region.anchors.some((a) => a.sameProvider);
  return (
    <li>
      <button className="region-row" onClick={() => onSelect(region)}>
        <span className="dot" style={{ background: p.color }} />
        <span className="region-main">
          <span className="region-title">
            <span className="region-name">
              <b style={{ color: p.color }}>{providerName(p, lang)}</b> {regionName(region, lang)}
            </span>
            {region.anchors.length > 0 && (
              <span className="badge src-atlas" title={t(same ? 'badge.liveTitle' : 'badge.proxyTitle')}>
                {t(same ? 'badge.live' : 'badge.proxy')}
              </span>
            )}
          </span>
          <span className="region-sub">
            {region.code} · {region.city} · {fmtKm(distanceKm)} km
          </span>
        </span>
        <span className="region-rtt">
          <span className="rtt-line src-estimate" title={t('tab.estimate')}>
            <span className="rtt-tag">{t('src.estimate.short')}</span>
            <span className="rtt-value">{fmtMs(rttMs)}</span>
            <span className="rtt-unit">ms</span>
          </span>
          {mineMs !== null && (
            <span className="rtt-line src-mine" title={t('tab.mine')}>
              <span className="rtt-tag">{t('src.mine.short')}</span>
              <span className="rtt-value">{fmtMs(mineMs)}</span>
              <span className="rtt-unit">ms</span>
            </span>
          )}
          <span className="rtt-bar" style={{ width: `${Math.max(6, (rttMs / max) * 100)}%` }} />
        </span>
      </button>
    </li>
  );
}

/** 默认只显示 5 个，“加载更多”每次再加 10 个，避免一下子铺满。 */
const FIRST = 5;
const MORE = 10;

/** 排好序的附近数据中心，分页展开。 */
export function RegionList({ items, onSelect }: { items: RankedRegion[]; onSelect: (r: Region) => void }) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(FIRST);
  if (!items.length) return <p className="muted">{t('list.empty')}</p>;
  const shown = items.slice(0, limit);
  const max = Math.max(...shown.map((i) => i.rttMs));
  return (
    <>
      <ol className="region-list">
        {shown.map((item) => (
          <RegionRow key={item.region.id} item={item} max={max} onSelect={onSelect} />
        ))}
      </ol>
      {items.length > limit && (
        <button className="link-button" onClick={() => setLimit(limit + MORE)}>
          {t('list.more', { shown: limit, total: items.length })}
        </button>
      )}
    </>
  );
}

/** 从全部数据中心里任选一个：按厂商筛选 + 搜索，保持传入的延迟顺序（从小到大）。 */
export function RegionPicker({ items, onSelect }: { items: RankedRegion[]; onSelect: (r: Region) => void }) {
  const { lang, t } = useI18n();
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [limit, setLimit] = useState(FIRST);
  useEffect(() => setLimit(FIRST), [query, provider]);

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (r: Region) =>
      !q ||
      [r.code, r.name, r.nameZh ?? '', r.city, r.country, PROVIDER_BY_ID[r.provider].name, PROVIDER_BY_ID[r.provider].nameZh ?? '']
        .some((s) => s.toLowerCase().includes(q));
    return items.filter((i) => (!provider || i.region.provider === provider) && match(i.region));
  }, [items, query, provider]);

  const total = matched.length;
  const shown = matched.slice(0, limit);
  const max = Math.max(1, ...shown.map((i) => i.rttMs));
  return (
    <div className="picker">
      <input
        className="picker-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('panel.anySearch')}
        aria-label={t('panel.anySearch')}
      />
      <div className="picker-providers">
        <button className={`chip ${provider === null ? 'chip-on' : 'chip-off'}`} onClick={() => setProvider(null)}>
          {t('panel.anyAll')}
        </button>
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            className={`chip ${provider === p.id ? 'chip-on' : 'chip-off'}`}
            onClick={() => setProvider(provider === p.id ? null : p.id)}
          >
            <span className="dot" style={{ background: p.color }} />
            {providerName(p, lang)}
          </button>
        ))}
      </div>
      {!total && <p className="muted">{t('list.empty')}</p>}
      <ol className="region-list">
        {shown.map((item) => (
          <RegionRow key={item.region.id} item={item} max={max} onSelect={onSelect} />
        ))}
      </ol>
      {total > limit && (
        <button className="link-button" onClick={() => setLimit(limit + MORE)}>
          {t('list.more', { shown: limit, total })}
        </button>
      )}
    </div>
  );
}
