import { useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import { endName } from '../lib/names.ts';
import { ACCESS_RTT_MS, FIBER_KM_PER_MS, LAND_INFLATION, type EstimatedRoute, type Segment } from '../lib/routing.ts';
import { fmtKm, fmtMs } from './RegionList.tsx';

interface Props {
  route: EstimatedRoute | null;
  onHover: (range: [number, number] | null) => void;
}

interface Group {
  kind: Segment['kind'];
  start: number;
  end: number;
  segments: Segment[];
  km: number;
  rttMs: number;
  cumulativeMs: number;
}

const KIND_KEY = { access: 'est.kind.access', land: 'est.kind.land', sub: 'est.kind.sub' } as const;

/** 连续的陆地段合并成一组展示（可展开），海缆段各自一行。 */
function groupSegments(segments: Segment[]): Group[] {
  const groups: Group[] = [];
  let cumulative = 0;
  segments.forEach((s, i) => {
    const last = groups[groups.length - 1];
    const rtt = s.oneWayMs * 2;
    cumulative += rtt;
    if (last && last.kind === 'land' && s.kind === 'land') {
      last.end = i;
      last.segments.push(s);
      last.km += s.km;
      last.rttMs += rtt;
      last.cumulativeMs = cumulative;
    } else {
      groups.push({ kind: s.kind, start: i, end: i, segments: [s], km: s.km, rttMs: rtt, cumulativeMs: cumulative });
    }
  });
  return groups;
}

export default function RouteEstimate({ route, onHover }: Props) {
  const { lang, t } = useI18n();
  const groups = useMemo(() => (route ? groupSegments(route.segments) : []), [route]);
  const [open, setOpen] = useState<number | null>(null);
  const name = (e: Segment['from']) => endName(e, lang, t);

  if (!route) {
    return <p className="muted">{t('est.unreachable')}</p>;
  }

  const subCount = route.segments.filter((s) => s.kind === 'sub').length;
  return (
    <div className="route-estimate">
      <div className="summary-grid">
        <div>
          <span className="summary-label">{t('est.rtt')}</span>
          <span className="summary-value">{fmtMs(route.rttMs)} ms</span>
        </div>
        <div>
          <span className="summary-label">{t('est.floor')}</span>
          <span className="summary-value dim">{fmtMs(route.floorRttMs)} ms</span>
        </div>
        <div>
          <span className="summary-label">{t('est.path')}</span>
          <span className="summary-value dim">{fmtKm(route.km)} km</span>
        </div>
        <div>
          <span className="summary-label">{t('est.cables')}</span>
          <span className="summary-value dim">{t('est.cablesValue', { n: subCount })}</span>
        </div>
      </div>

      <ol className="timeline">
        {groups.map((g, gi) => {
          const first = g.segments[0];
          const last = g.segments[g.segments.length - 1];
          const cable = first.cable;
          const expandable = g.kind === 'land' && g.segments.length > 1;
          return (
            <li
              key={gi}
              className={`tl-item tl-${g.kind}`}
              onMouseEnter={() => onHover([g.start, g.end])}
              onMouseLeave={() => onHover(null)}
            >
              <div className="tl-head">
                <span className="tl-kind">{t(KIND_KEY[g.kind])}</span>
                <span className="tl-rtt">
                  +{fmtMs(g.rttMs)} ms <span className="tl-cum">{t('est.cumulative', { ms: fmtMs(g.cumulativeMs) })}</span>
                </span>
              </div>
              {g.kind === 'access' ? (
                <div className="tl-body muted">{t('est.access', { ms: ACCESS_RTT_MS })}</div>
              ) : (
                <div className="tl-body">
                  <div className="tl-path">
                    {name(first.from)} → {name(last.to)}
                  </div>
                  <div className="tl-meta">
                    {fmtKm(g.km)} km
                    {cable && (
                      <>
                        {' · '}
                        <a href={`https://www.submarinecablemap.com/submarine-cable/${cable.id}`} target="_blank" rel="noreferrer">
                          {cable.name}
                        </a>
                        {cable.rfsYear ? ` · ${t('est.rfs', { year: cable.rfsYear })}` : ''}
                      </>
                    )}
                    {expandable && (
                      <>
                        {' · '}
                        <button className="link-button inline" onClick={() => setOpen(open === gi ? null : gi)}>
                          {open === gi ? t('est.collapse') : t('est.via', { n: g.segments.length - 1 })}
                        </button>
                      </>
                    )}
                  </div>
                  {cable?.owners && <div className="tl-owners">{t('est.owners', { owners: cable.owners })}</div>}
                  {expandable && open === gi && (
                    <ol className="tl-hops">
                      {g.segments.map((s, i) => (
                        <li key={i} onMouseEnter={() => onHover([g.start + i, g.start + i])}>
                          <span>
                            {name(s.from)} → {name(s.to)}
                          </span>
                          <span className="muted">
                            {fmtKm(s.km)} km · {fmtMs(s.oneWayMs * 2)} ms
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <details className="assumptions">
        <summary>{t('est.method')}</summary>
        <ul>
          <li>{t('est.m1', { speed: FIBER_KM_PER_MS.toFixed(0) })}</li>
          <li>{t('est.m2')}</li>
          <li>{t('est.m3', { k: LAND_INFLATION })}</li>
          <li>{t('est.m4')}</li>
        </ul>
      </details>
    </div>
  );
}
