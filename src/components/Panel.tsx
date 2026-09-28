import type { Place } from '../lib/places.ts';
import { PROVIDER_BY_ID } from '../lib/providers.ts';
import type { EstimatedRoute } from '../lib/routing.ts';
import type { AnchorProbe, Region } from '../lib/types.ts';
import type { TraceOverlay } from './GlobeView.tsx';
import RegionList, { type RankedRegion } from './RegionList.tsx';
import RouteAtlas from './RouteAtlas.tsx';
import RouteEstimate from './RouteEstimate.tsx';

export type RouteTab = 'estimate' | 'atlas';

interface Props {
  open: boolean;
  origin: { lat: number; lng: number } | null;
  place: Place | null;
  onLand: boolean;
  ranked: RankedRegion[];
  target: Region | null;
  tab: RouteTab;
  route: EstimatedRoute | null;
  anchorProbes: AnchorProbe[];
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
  const { open, origin, place, onLand, ranked, target, tab, route } = props;
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
                    {admin1 && <span>{admin1.nameZh || admin1.name}</span>}
                    <span className={admin1 ? 'place-country' : ''}>{country.nameZh || country.name}</span>
                  </>
                ) : (
                  <span>{onLand ? '未知地区' : '海上'}</span>
                )}
              </div>
              <div className="place-sub">
                {country && (
                  <>
                    {admin1 ? `${admin1.name}, ` : ''}
                    {country.name}
                    {admin1?.type ? ` · ${admin1.type}` : ''} ·{' '}
                  </>
                )}
                {fmtCoord(origin.lat, origin.lng)}
              </div>
            </div>
            <button className="icon-button" onClick={props.onClose} aria-label="关闭">
              ×
            </button>
          </header>

          {target ? (
            <section className="panel-body">
              <button className="link-button back" onClick={() => props.onSelect(null)}>
                ← 附近的数据中心
              </button>
              <div className="target-title">
                <span className="dot" style={{ background: PROVIDER_BY_ID[target.provider].color }} />
                <div>
                  <b style={{ color: PROVIDER_BY_ID[target.provider].color }}>{PROVIDER_BY_ID[target.provider].name}</b>{' '}
                  {target.name}
                  <div className="place-sub">
                    {target.code} · {target.city}, {target.country}
                  </div>
                </div>
              </div>
              <div className="tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'estimate'} className={tab === 'estimate' ? 'tab-on' : ''} onClick={() => props.onTab('estimate')}>
                  物理路径估算
                </button>
                <button role="tab" aria-selected={tab === 'atlas'} className={tab === 'atlas' ? 'tab-on' : ''} onClick={() => props.onTab('atlas')}>
                  RIPE Atlas 实测
                  {target.anchors.length > 0 && <span className="tab-dot" />}
                </button>
              </div>
              {tab === 'estimate' ? (
                onLand ? (
                  <RouteEstimate route={route} onHover={props.onHoverRange} />
                ) : (
                  <p className="muted">起点在海上，无法估算物理路径。请点击陆地。</p>
                )
              ) : (
                <RouteAtlas
                  key={target.id}
                  region={target}
                  origin={origin}
                  anchorProbes={props.anchorProbes}
                  onOverlay={props.onOverlay}
                />
              )}
            </section>
          ) : (
            <section className="panel-body">
              <h2 className="section-title">
                附近的云数据中心
                <span className="muted">按估算 RTT 排序</span>
              </h2>
              {!onLand && <p className="muted small">起点在海上，延迟按直线距离 × 1.5 粗估。</p>}
              <RegionList key={`${origin.lat},${origin.lng}`} items={ranked} onSelect={(r) => props.onSelect(r)} />
            </section>
          )}
        </>
      )}
    </aside>
  );
}
