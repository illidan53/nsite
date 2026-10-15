import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import { providerName, regionName } from '../lib/names.ts';
import { PROVIDERS, PROVIDER_BY_ID } from '../lib/providers.ts';
import type { MeasuredOrigin } from '../lib/measured.ts';
import type { ProviderId, Region } from '../lib/types.ts';

export interface RankedRegion {
  region: Region;
  distanceKm: number;
  /** 模型估算 RTT。 */
  rttMs: number;
  /** 站长实测（批量）里到达该区域的最低 RTT；没有测过或没到达时为 null。 */
  mineMs: number | null;
  /** 测过但所有探针都没到达。 */
  mineUnreached: boolean;
  /** 实测值来自哪个地区（各行可能不同：每个数据中心取最近、测过它的地区）。 */
  mineFrom: MeasuredOrigin | null;
}

export type SortBy = 'estimate' | 'mine';

export function fmtMs(ms: number) {
  return Math.abs(ms) < 10 ? ms.toFixed(1) : Math.round(ms).toString();
}

export function fmtKm(km: number) {
  return km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString();
}

/** 默认显示 8 个，“加载更多”每次再加 10 个。 */
export const FIRST = 8;
export const MORE = 10;
export const ALL_PROVIDERS: ProviderId[] = PROVIDERS.map((p) => p.id);

function matchesQuery(r: Region, q: string) {
  return (
    !q ||
    [r.code, r.name, r.nameZh ?? '', r.city, r.country, PROVIDER_BY_ID[r.provider].name, PROVIDER_BY_ID[r.provider].nameZh ?? ''].some((s) =>
      s.toLowerCase().includes(q),
    )
  );
}

/**
 * 选择器的列表：先按厂商筛选定下名次（搜索时名次不变），再按搜索词过滤。
 * ranked：按厂商筛选后的名次顺序（第一个就是“最低”）；hidden：搜索词在未选中的厂商里还匹配到多少个。
 */
export function chooserLists(sorted: RankedRegion[], providers: Set<ProviderId>, query: string) {
  const q = query.trim().toLowerCase();
  const ranked = sorted.filter((i) => providers.has(i.region.provider));
  const rank = new Map(ranked.map((i, n) => [i.region.id, n + 1]));
  const visible = ranked.filter((i) => matchesQuery(i.region, q));
  const hidden = q ? sorted.filter((i) => !providers.has(i.region.provider) && matchesQuery(i.region, q)).length : 0;
  return { ranked, visible, rank, hidden };
}

function RegionRow({ item, rank, max, top, hasMine, onSelect }: { item: RankedRegion; rank: number; max: number; top: boolean; hasMine: boolean; onSelect: (r: Region) => void }) {
  const { lang, t } = useI18n();
  const { region, distanceKm, rttMs, mineMs, mineUnreached, mineFrom } = item;
  const fromTitle = mineFrom ? t('row.mineFrom', { cell: mineFrom.id, km: fmtKm(mineFrom.km) }) : undefined;
  const p = PROVIDER_BY_ID[region.provider];
  const same = region.anchors.some((a) => a.sameProvider);
  const name = `${providerName(p, lang)} ${regionName(region, lang)}`;
  const aria =
    t('row.aria', { rank, name, code: region.code, city: region.city, km: fmtKm(distanceKm), est: fmtMs(rttMs) }) +
    (mineMs !== null ? t('row.ariaMine', { ms: fmtMs(mineMs) }) : mineUnreached ? `, ${t('mine.unreachedTitle')}` : '') +
    (region.anchors.length ? `, ${t(same ? 'badge.live' : 'badge.proxy')}` : '');
  return (
    <li>
      <button className={`region-row ${top ? 'rank-top' : ''}`} data-region-id={region.id} aria-label={aria} onClick={() => onSelect(region)}>
        <span className={`rank ${rank <= 3 ? 'rank-podium' : ''}`}>{rank}</span>
        <span className="region-main">
          <span className="region-title">
            <span className="dot" style={{ background: p.color }} />
            <span className="region-name">
              <b style={{ color: p.color }}>{providerName(p, lang)}</b> {regionName(region, lang)}
            </span>
            {top && <span className="tag-lowest">{t('chooser.lowest')}</span>}
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
        <span className="rtt-col src-estimate">
          <span className="rtt-num">
            <span className="rtt-tag">{t('src.estimate.short')}</span>
            <span className="rtt-value">{fmtMs(rttMs)}</span>
            <span className="rtt-unit">ms</span>
          </span>
          <span className="lat-track" aria-hidden="true">
            <span className="lat-fill" style={{ width: `${Math.max(6, Math.min(100, (rttMs / max) * 100))}%` }} />
            {mineMs !== null && <span className="lat-tick" style={{ left: `${Math.min(100, (mineMs / max) * 100)}%` }} />}
          </span>
        </span>
        {hasMine && (
          <span className={`rtt-col src-mine ${mineMs === null && !mineUnreached ? 'is-empty' : ''}`}>
            {mineMs !== null ? (
              <span className="rtt-num" title={fromTitle}>
                <span className="rtt-tag">{t('src.mine.short')}</span>
                <span className="rtt-value">{fmtMs(mineMs)}</span>
                <span className="rtt-unit">ms</span>
              </span>
            ) : mineUnreached ? (
              <span className="rtt-num rtt-unreached" title={`${t('mine.unreachedTitle')} · ${fromTitle ?? ''}`}>
                <span className="rtt-tag">{t('src.mine.short')}</span>
                {t('mine.unreachedShort')}
              </span>
            ) : (
              <span className="rtt-none">—</span>
            )}
          </span>
        )}
        <span className="row-chev" aria-hidden="true">
          ›
        </span>
      </button>
    </li>
  );
}

interface ChooserProps {
  /** 全部数据中心，已按当前排序方式排好。 */
  sorted: RankedRegion[];
  visible: RankedRegion[];
  rank: Map<string, number>;
  hidden: number;
  providers: Set<ProviderId>;
  onProviders: (next: Set<ProviderId>) => void;
  query: string;
  onQuery: (q: string) => void;
  sortBy: SortBy;
  onSortBy: (s: SortBy) => void;
  hasMine: boolean;
  limit: number;
  onLimit: (n: number) => void;
  /** “实测起点 …”一行。 */
  note: string;
  onLand: boolean;
  /** 从路线页点了新起点时，上次看的数据中心（一键回到那条路线）。 */
  recent: Region | null;
  searchRef: RefObject<HTMLInputElement | null>;
  onSelect: (r: Region) => void;
}

/** 把“附近的数据中心”和“任选数据中心”合成一个按延迟排好的选择器：搜索、厂商筛选、排序都作用在同一个列表上。 */
export function RegionChooser(props: ChooserProps) {
  const { sorted, visible, rank, hidden, providers, query, sortBy, hasMine, limit, note, onLand, recent, searchRef, onSelect } = props;
  const { lang, t } = useI18n();
  const all = providers.size === ALL_PROVIDERS.length;
  const counts = new Map<ProviderId, number>();
  for (const i of sorted) counts.set(i.region.provider, (counts.get(i.region.provider) ?? 0) + 1);

  const shown = visible.slice(0, limit);
  const max = Math.max(1, ...shown.map((i) => Math.max(i.rttMs, i.mineMs ?? 0)));
  const countText = query.trim() ? t('chooser.matches', { n: visible.length }) : t('chooser.count', { n: visible.length });

  // 吸顶的搜索栏有多高：滚动容器按这个高度留出 scroll-padding，键盘移到的行不会被它挡住
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = barRef.current;
    const fw = bar?.closest<HTMLElement>('.fw');
    if (!bar || !fw) return;
    const ro = new ResizeObserver(() => fw.style.setProperty('--chooser-bar-h', `${bar.offsetHeight}px`));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  // 读屏：数量变化稍等一下再播报，避免边打字边念
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setAnnounce(countText), 300);
    return () => clearTimeout(id);
  }, [countText]);

  const toggleProvider = (id: ProviderId) => {
    if (all) return props.onProviders(new Set([id]));
    const next = new Set(providers);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    props.onProviders(next.size ? next : new Set(ALL_PROVIDERS));
  };

  const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.chooser-list .region-row')];
  const onListKey = (e: KeyboardEvent<HTMLOListElement>) => {
    const list = rows();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => {
      e.preventDefault();
      list[Math.max(0, Math.min(list.length - 1, n))]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') i <= 0 ? (e.preventDefault(), searchRef.current?.focus()) : go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
  };

  const sortButton = (k: SortBy, cls: string) => (
    <button key={k} className={`${cls} src-${k} ${sortBy === k ? 'is-on' : ''}`} aria-pressed={sortBy === k} onClick={() => props.onSortBy(k)}>
      {t(`sort.${k}`)}
    </button>
  );

  return (
    <div className={`chooser ${hasMine ? 'has-mine' : ''}`} data-sort={hasMine ? sortBy : 'estimate'}>
      <div className="chooser-bar" ref={barRef}>
        <div className="chooser-titlebar">
          <h3 className="chooser-title">{t('fw.choose')}</h3>
          <span className="chooser-count">{countText}</span>
        </div>
        <label className="search-field">
          <svg className="search-icon" viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M13 13l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            className="picker-search"
            type="search"
            value={query}
            onChange={(e) => props.onQuery(e.target.value)}
            onKeyDown={(e) => {
              // Esc 先清空搜索词，不关窗口（App 的 Esc 处理会看 defaultPrevented）
              if (e.key === 'Escape' && query) {
                props.onQuery('');
                e.preventDefault();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                rows()[0]?.focus();
              }
            }}
            placeholder={t('panel.anySearch')}
            aria-label={t('panel.anySearch')}
          />
          {!query && (
            <kbd className="kbd" title={t('chooser.searchKey')}>
              /
            </kbd>
          )}
        </label>
        <div className="chooser-chips" role="group" aria-label={t('chooser.providers')}>
          <button className={`chip ${all ? 'chip-on' : 'chip-off'}`} aria-pressed={all} onClick={() => props.onProviders(new Set(ALL_PROVIDERS))}>
            {t('panel.anyAll')}
          </button>
          {PROVIDERS.map((p) => {
            const name = providerName(p, lang);
            return (
              <button
                key={p.id}
                className={`chip ${providers.has(p.id) ? 'chip-on' : 'chip-off'}`}
                aria-pressed={!all && providers.has(p.id)}
                title={t(all ? 'chooser.only' : 'chooser.toggle', { p: name })}
                onClick={() => toggleProvider(p.id)}
              >
                <span className="dot" style={{ background: p.color }} />
                {name}
                <span className="chip-count">{counts.get(p.id) ?? 0}</span>
              </button>
            );
          })}
        </div>
        <div className="chooser-note">
          <span className="chooser-note-text">
            <span className="src-swatch src-mine" aria-hidden="true" />
            {note}
            {!onLand && <span className="ocean-note"> {t('panel.oceanNote')}</span>}
          </span>
          {hasMine ? (
            <span className="sort-seg segmented" role="group" aria-label={t('panel.sortBy')}>
              {(['estimate', 'mine'] as SortBy[]).map((k) => (
                <button key={k} className={`src-${k} ${sortBy === k ? 'seg-on' : ''}`} aria-pressed={sortBy === k} onClick={() => props.onSortBy(k)}>
                  {t(`sort.${k}`)}
                </button>
              ))}
            </span>
          ) : (
            <span className="muted sort-plain">{t('panel.nearbySort')}</span>
          )}
        </div>
        <div className="col-head" role={hasMine ? 'group' : undefined} aria-label={hasMine ? t('panel.sortBy') : undefined}>
          <span className="rank" title={t('col.rank')}>
            #
          </span>
          <span>{t('col.dc')}</span>
          {hasMine ? sortButton('estimate', 'col-sort') : <span className="col-label src-estimate">{t('sort.estimate')}</span>}
          {hasMine && sortButton('mine', 'col-sort')}
          <span />
        </div>
      </div>

      {recent && (
        <button className="recent-link" onClick={() => onSelect(recent)}>
          <span className="dot" style={{ background: PROVIDER_BY_ID[recent.provider].color }} />
          {t('chooser.recent', { dc: `${providerName(PROVIDER_BY_ID[recent.provider], lang)} ${regionName(recent, lang)}` })}
        </button>
      )}

      {shown.length ? (
        <ol className="region-list chooser-list" onKeyDown={onListKey}>
          {shown.map((item) => {
            const r = rank.get(item.region.id) ?? 0;
            return <RegionRow key={item.region.id} item={item} rank={r} max={max} top={r === 1 && !query.trim()} hasMine={hasMine} onSelect={onSelect} />;
          })}
        </ol>
      ) : (
        <p className="muted">{t('list.empty')}</p>
      )}
      {visible.length > limit && (
        <button
          className="load-more"
          onClick={() => {
            props.onLimit(limit + MORE);
            // 按钮可能随之消失：焦点移到新出现的第一行
            requestAnimationFrame(() => rows()[limit]?.focus());
          }}
        >
          {t('list.more', { shown: limit, total: visible.length })}
        </button>
      )}
      {hidden > 0 && (
        <p className="hidden-hint muted">
          {t('chooser.hidden', { n: hidden })}{' '}
          <button
            className="link-button inline"
            onClick={() => {
              props.onProviders(new Set(ALL_PROVIDERS));
              searchRef.current?.focus();
            }}
          >
            {t('chooser.showAll')}
          </button>
        </p>
      )}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
