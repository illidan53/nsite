import { useI18n } from '../lib/i18n.tsx';
import { providerName, regionName } from '../lib/names.ts';
import type { Place } from '../lib/places.ts';
import { PROVIDER_BY_ID } from '../lib/providers.ts';
import type { EstimatedRoute } from '../lib/routing.ts';
import type { AnchorProbe, Region, TestTarget } from '../lib/types.ts';
import type { TraceOverlay } from './GlobeView.tsx';
import { RegionList, RegionPicker, type RankedRegion } from './RegionList.tsx';
import PersonalMeasure from './PersonalMeasure.tsx';
import RouteAtlas from './RouteAtlas.tsx';
import RouteEstimate from './RouteEstimate.tsx';
import Section from './Section.tsx';

export type RouteTab = 'estimate' | 'mine' | 'atlas';

interface Props {
  open: boolean;
  origin: { lat: number; lng: number } | null;
  place: Place | null;
  onLand: boolean;
  /** 附近（已按厂商筛选、按估算 RTT 排序）。 */
  nearby: RankedRegion[];
  /** 全部数据中心，供“任选”使用。 */
  all: RankedRegion[];
  target: Region | null;
  tab: RouteTab;
  route: EstimatedRoute | null;
  anchorProbes: AnchorProbe[];
  /** 该区域的公开测试地址（站长实测的目标）。 */
  publicTarget: TestTarget | undefined;
  owner: boolean;
  onClose: () => void;
  onSelect: (r: Region | null) => void;
  onTab: (t: RouteTab) => void;
  onHoverRange: (r: [number, number] | null) => void;
  onOverlay: (o: TraceOverlay | null) => void;
}

function fmtCoord(lat: number, lng: number) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'}`;
}

export default function Panel(props: Props) {
  const { open, origin, place, onLand, nearby, all, target, tab, route } = props;
  const { lang, t, pick } = useI18n();
  const country = place?.country;
  const admin1 = place?.admin1;

  return (
    <aside className={`panel ${open ? 'panel-open' : ''}`} aria-hidden={!open}>
      {origin && (
        <>
          <header className="panel-header">
            <div>
              <div className="place-title">
                {country ? (
                  <>
                    {admin1 && <span>{pick(admin1.name, admin1.nameZh)}</span>}
                    <span className={admin1 ? 'place-country' : ''}>{pick(country.name, country.nameZh)}</span>
                  </>
                ) : (
                  <span>{t(onLand ? 'place.unknown' : 'place.ocean')}</span>
                )}
              </div>
              <div className="place-sub">
                {country && lang === 'zh' && (
                  <>
                    {admin1 ? `${admin1.name}, ` : ''}
                    {country.name} ·{' '}
                  </>
                )}
                {admin1?.type ? `${admin1.type} · ` : ''}
                {fmtCoord(origin.lat, origin.lng)}
              </div>
            </div>
            <button className="icon-button" onClick={props.onClose} aria-label={t('place.close')}>
              ×
            </button>
          </header>

          {target ? (
            <section className="panel-body">
              <button className="link-button back" onClick={() => props.onSelect(null)}>
                {t('panel.back')}
              </button>
              <div className="target-title">
                <span className="dot" style={{ background: PROVIDER_BY_ID[target.provider].color }} />
                <div>
                  <b style={{ color: PROVIDER_BY_ID[target.provider].color }}>{providerName(PROVIDER_BY_ID[target.provider], lang)}</b>{' '}
                  {regionName(target, lang)}
                  <div className="place-sub">
                    {target.code} · {target.city}, {target.country}
                  </div>
                </div>
              </div>
              <div className="tabs tabs-3" role="tablist">
                <button role="tab" aria-selected={tab === 'estimate'} className={tab === 'estimate' ? 'tab-on' : ''} onClick={() => props.onTab('estimate')}>
                  {t('tab.estimate')}
                </button>
                <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'tab-on' : ''} onClick={() => props.onTab('mine')}>
                  {t('tab.mine')}
                </button>
                <button role="tab" aria-selected={tab === 'atlas'} className={tab === 'atlas' ? 'tab-on' : ''} onClick={() => props.onTab('atlas')}>
                  {t('tab.atlas')}
                  {target.anchors.length > 0 && <span className="tab-dot" />}
                </button>
              </div>
              {tab === 'estimate' &&
                (onLand ? <RouteEstimate route={route} onHover={props.onHoverRange} /> : <p className="muted">{t('panel.oceanRoute')}</p>)}
              {tab === 'mine' && (
                <PersonalMeasure
                  key={`${target.id}|${origin.lat},${origin.lng}`}
                  region={target}
                  origin={origin}
                  place={place}
                  publicTarget={props.publicTarget}
                  owner={props.owner}
                  onOverlay={props.onOverlay}
                />
              )}
              {tab === 'atlas' && (
                <RouteAtlas key={target.id} region={target} origin={origin} anchorProbes={props.anchorProbes} onOverlay={props.onOverlay} />
              )}
            </section>
          ) : (
            <div className="panel-body">
              <Section
                storageKey="nsite-section-nearby"
                defaultOpen
                title={t('panel.nearby')}
                aside={<span className="muted">{t('panel.nearbySort')}</span>}
              >
                {!onLand && <p className="muted small">{t('panel.oceanNote')}</p>}
                <RegionList key={`${origin.lat},${origin.lng}`} items={nearby} onSelect={(r) => props.onSelect(r)} />
              </Section>
              <Section storageKey="nsite-section-any" defaultOpen={false} title={t('panel.any')} aside={<span className="muted">{all.length}</span>}>
                <RegionPicker items={all} onSelect={(r) => props.onSelect(r)} />
              </Section>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
