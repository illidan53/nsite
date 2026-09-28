import { useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import { providerName, regionName } from '../lib/names.ts';
import { PROVIDERS, PROVIDER_BY_ID } from '../lib/providers.ts';
import type { ProviderId, Region, TargetsData, TestTarget } from '../lib/types.ts';
import { fmtMs } from './RegionList.tsx';

interface Props {
  open: boolean;
  data: TargetsData | null;
  regionById: Map<string, Region>;
  selected: string | null;
  onSelect: (regionId: string | null) => void;
  onClose: () => void;
}

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      className="copy-button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {t(done ? 'ips.copied' : 'ips.copy')}
    </button>
  );
}

function Detail({ target, region, checkedAt }: { target: TestTarget; region: Region | undefined; checkedAt: string }) {
  const { lang, t } = useI18n();
  const p = PROVIDER_BY_ID[target.provider];
  const { icmpMs, tcpMs, floorMs } = target.localCheck;
  return (
    <div className="ip-detail">
      <div className="target-title">
        <span className="dot" style={{ background: p.color }} />
        <div>
          <b style={{ color: p.color }}>{providerName(p, lang)}</b> {region ? regionName(region, lang) : target.region}
          <div className="place-sub">
            {region?.code ?? target.region} · {target.city}
          </div>
        </div>
      </div>
      <dl className="ip-fields">
        <dt>{t('ips.ip')}</dt>
        <dd>
          <span className="mono ip-value">{target.ip ?? '—'}</span>
          {target.ip && <CopyButton text={target.ip} />}
        </dd>
        <dt>{t('ips.host')}</dt>
        <dd>
          <span className="mono">{target.host}</span>
          <CopyButton text={target.host} />
        </dd>
        <dt>{t('ips.source')}</dt>
        <dd>
          {target.source[lang]}
          {target.source.url && (
            <>
              {' · '}
              <a href={target.source.url} target="_blank" rel="noreferrer">
                {t('ips.docs')}
              </a>
            </>
          )}
          {target.note && <div className="muted small">{target.note}</div>}
        </dd>
        <dt>{t('ips.method')}</dt>
        <dd>{t(target.method === 'icmp' ? 'ips.method.icmp' : 'ips.method.tcp443')}</dd>
        <dt>{t('ips.check')}</dt>
        <dd>
          {icmpMs !== null || tcpMs !== null ? (
            <span>
              {icmpMs !== null && <>ping {fmtMs(icmpMs)} ms</>}
              {icmpMs !== null && tcpMs !== null && ' · '}
              {tcpMs !== null && <>TCP {fmtMs(tcpMs)} ms</>}
              {floorMs !== null && <> · {t('ips.floor', { ms: `${fmtMs(floorMs)} ms` })}</>}
            </span>
          ) : (
            '—'
          )}
          <div className="muted small">{t('ips.checkFrom', { date: checkedAt })}</div>
        </dd>
      </dl>
      <p className="muted small">{t('ips.ipNote')}</p>
    </div>
  );
}

/** “公开测试 IP”面板：各区域可 ping / TCP 连接的公开地址、数据源与初次检查结果。 */
export default function TargetsPanel({ open, data, regionById, selected, onSelect, onClose }: Props) {
  const { lang, t } = useI18n();
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const targets = useMemo(() => data?.targets ?? [], [data]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (x: TestTarget) => {
      const r = regionById.get(x.region);
      return (
        !q ||
        [x.region, x.city, x.host, x.ip ?? '', r?.name ?? '', r?.nameZh ?? '', PROVIDER_BY_ID[x.provider].name, PROVIDER_BY_ID[x.provider].nameZh ?? '']
          .some((s) => s.toLowerCase().includes(q))
      );
    };
    return PROVIDERS.filter((p) => !provider || p.id === provider)
      .map((p) => ({ provider: p, items: targets.filter((x) => x.provider === p.id && match(x)) }))
      .filter((g) => g.items.length);
  }, [targets, query, provider, regionById]);

  const counts = useMemo(() => {
    const m = new Map<ProviderId, number>();
    for (const x of targets) m.set(x.provider, (m.get(x.provider) ?? 0) + 1);
    return m;
  }, [targets]);
  const current = selected ? targets.find((x) => x.region === selected) : undefined;

  return (
    <aside className={`panel ${open ? 'panel-open' : ''}`} aria-hidden={!open}>
      {open && data && (
        <>
          <header className="panel-header">
            <div>
              <div className="place-title">
                <span>{t('ips.title')}</span>
              </div>
              <div className="place-sub">
                {t('ips.stats', {
                  n: targets.length,
                  icmp: targets.filter((x) => x.method === 'icmp').length,
                  tcp: targets.filter((x) => x.method === 'tcp443').length,
                })}
              </div>
            </div>
            <button className="icon-button" onClick={onClose} aria-label={t('place.close')}>
              ×
            </button>
          </header>
          <div className="panel-body">
            {current ? (
              <>
                <button className="link-button back" onClick={() => onSelect(null)}>
                  {t('ips.back')}
                </button>
                <Detail target={current} region={regionById.get(current.region)} checkedAt={data.checkedAt} />
              </>
            ) : (
              <>
                <div className="callout">
                  <p>{t('ips.intro')}</p>
                  <p className="muted small">{data.localCheck[lang]}</p>
                  <p className="muted small">{t('ips.gcp')}</p>
                </div>
                <div className="picker">
                  <input
                    className="picker-search"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('ips.search')}
                    aria-label={t('ips.search')}
                  />
                  <div className="picker-providers">
                    <button className={`chip ${provider === null ? 'chip-on' : 'chip-off'}`} onClick={() => setProvider(null)}>
                      {t('panel.anyAll')}
                    </button>
                    {PROVIDERS.filter((p) => counts.get(p.id)).map((p) => (
                      <button
                        key={p.id}
                        className={`chip ${provider === p.id ? 'chip-on' : 'chip-off'}`}
                        onClick={() => setProvider(provider === p.id ? null : p.id)}
                      >
                        <span className="dot" style={{ background: p.color }} />
                        {providerName(p, lang)}
                        <span className="chip-count">{counts.get(p.id)}</span>
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
                        {g.items.map((x) => {
                          const r = regionById.get(x.region);
                          return (
                            <li key={x.region}>
                              <button className="region-row ip-row" onClick={() => onSelect(x.region)}>
                                <span className="dot" style={{ background: g.provider.color }} />
                                <span className="region-main">
                                  <span className="region-title">
                                    <span className="region-name">{r ? regionName(r, lang) : x.region}</span>
                                  </span>
                                  <span className="region-sub mono">
                                    {x.ip ?? '—'} · {x.host}
                                  </span>
                                </span>
                                <span className={`badge ${x.method === 'icmp' ? 'badge-live' : 'badge-proxy'}`}>
                                  {t(x.method === 'icmp' ? 'ips.badge.icmp' : 'ips.badge.tcp443')}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
