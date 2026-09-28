import { useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import { providerName, regionName } from '../lib/names.ts';
import { PROVIDERS, PROVIDER_BY_ID } from '../lib/providers.ts';
import type { ProviderId, Region } from '../lib/types.ts';

export interface RankedRegion {
  region: Region;
  distanceKm: number;
  rttMs: number;
}

export function fmtMs(ms: number) {
  return Math.abs(ms) < 10 ? ms.toFixed(1) : Math.round(ms).toString();
}

export function fmtKm(km: number) {
  return km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString();
}

function RegionRow({ item, max, onSelect }: { item: RankedRegion; max: number; onSelect: (r: Region) => void }) {
  const { lang, t } = useI18n();
  const { region, distanceKm, rttMs } = item;
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
              <span className={`badge ${same ? 'badge-live' : 'badge-proxy'}`} title={t(same ? 'badge.liveTitle' : 'badge.proxyTitle')}>
                {t(same ? 'badge.live' : 'badge.proxy')}
              </span>
            )}
          </span>
          <span className="region-sub">
            {region.code} · {region.city} · {fmtKm(distanceKm)} km
          </span>
        </span>
        <span className="region-rtt">
          <span className="rtt-value">{fmtMs(rttMs)}</span>
          <span className="rtt-unit">ms</span>
          <span className="rtt-bar" style={{ width: `${Math.max(6, (rttMs / max) * 100)}%` }} />
        </span>
      </button>
    </li>
  );
}

const PAGE = 12;

/** 按估算 RTT 排好序的附近数据中心，分页展开。 */
export function RegionList({ items, onSelect }: { items: RankedRegion[]; onSelect: (r: Region) => void }) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(PAGE);
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
        <button className="link-button" onClick={() => setLimit(limit + PAGE)}>
          {t('list.more', { n: Math.min(PAGE, items.length - limit), total: items.length })}
        </button>
      )}
    </>
  );
}

/** 从全部数据中心里任选一个：按厂商筛选 + 搜索，结果按厂商分组。 */
export function RegionPicker({ items, onSelect }: { items: RankedRegion[]; onSelect: (r: Region) => void }) {
  const { lang, t } = useI18n();
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<ProviderId | null>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (r: Region) =>
      !q ||
      [r.code, r.name, r.nameZh ?? '', r.city, r.country, PROVIDER_BY_ID[r.provider].name, PROVIDER_BY_ID[r.provider].nameZh ?? '']
        .some((s) => s.toLowerCase().includes(q));
    return PROVIDERS.filter((p) => !provider || p.id === provider)
      .map((p) => ({
        provider: p,
        items: items
          .filter((i) => i.region.provider === p.id && match(i.region))
          .sort((a, b) => regionName(a.region, lang).localeCompare(regionName(b.region, lang))),
      }))
      .filter((g) => g.items.length);
  }, [items, query, provider, lang]);

  const max = Math.max(1, ...groups.flatMap((g) => g.items.map((i) => i.rttMs)));
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
      {!groups.length && <p className="muted">{t('list.empty')}</p>}
      {groups.map((g) => (
        <div key={g.provider.id} className="picker-group">
          <div className="picker-group-title">
            <span className="dot" style={{ background: g.provider.color }} />
            {providerName(g.provider, lang)}
            <span className="muted">{g.items.length}</span>
          </div>
          <ol className="region-list">
            {g.items.map((item) => (
              <RegionRow key={item.region.id} item={item} max={max} onSelect={onSelect} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
