import { useMemo, useRef, useState } from 'react';
import { RTT_CALIBRATION } from '../lib/calibration.ts';
import { useI18n } from '../lib/i18n.tsx';
import { endName } from '../lib/names.ts';
import { ACCESS_RTT_MS, FIBER_KM_PER_MS, LAND_INFLATION, type EstimatedRoute, type Segment } from '../lib/routing.ts';
import { fmtKm, fmtMs } from './RegionList.tsx';

interface Props {
  route: EstimatedRoute | null;
  /** 按站长实测校准后的估算 RTT（物理最短路径 + 路由与排队开销）；没有时只显示物理路径。 */
  estimateMs: number | null;
  /** 校准用了哪条规则（决定开销那一行怎么解释）。 */
  rule: 'k' | 'into' | 'out';
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

/** 时间线和延迟构成条里“路由与排队开销”那一项的编号（不对应地球上的路段）。 */
const OVERHEAD = -1;

export default function RouteEstimate({ route, estimateMs, rule, onHover }: Props) {
  const { lang, t } = useI18n();
  const groups = useMemo(() => (route ? groupSegments(route.segments) : []), [route]);
  const [open, setOpen] = useState<number | null>(null);
  /** 延迟构成条和时间线里同时高亮的那一组。 */
  const [hot, setHot] = useState<number | null>(null);
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const overheadRef = useRef<HTMLLIElement>(null);
  const name = (e: Segment['from']) => endName(e, lang, t);

  if (!route) {
    return <p className="muted">{t('est.unreachable')}</p>;
  }

  const enter = (gi: number) => {
    setHot(gi);
    onHover(gi === OVERHEAD ? null : [groups[gi].start, groups[gi].end]);
  };
  const leave = () => {
    setHot(null);
    onHover(null);
  };
  const total = estimateMs ?? route.rttMs;
  const overheadMs = Math.max(0, total - route.rttMs);
  const pathOf = (g: Group) => (g.kind === 'access' ? t('est.access', { ms: ACCESS_RTT_MS }) : `${name(g.segments[0].from)} → ${name(g.segments[g.segments.length - 1].to)}`);
  const subCount = route.segments.filter((s) => s.kind === 'sub').length;
  return (
    <div className="route-estimate">
      <div className="latency-ribbon">
        <div className="ribbon-head">
          <span className="summary-label">{t('route.budget')}</span>
          <b>{fmtMs(total)} ms</b>
        </div>
        <div className="ribbon-bar">
          {groups.map((g, gi) => (
            <button
              key={gi}
              className={`rib-seg rib-${g.kind} ${hot === gi ? 'is-hot' : ''}`}
              style={{ flex: `${g.rttMs} 1 0` }}
              aria-label={t('route.segment', { kind: t(KIND_KEY[g.kind]), path: pathOf(g), ms: fmtMs(g.rttMs), total: fmtMs(g.cumulativeMs) })}
              title={`${t(KIND_KEY[g.kind])} · ${pathOf(g)}`}
              onMouseEnter={() => enter(gi)}
              onMouseLeave={leave}
              onFocus={() => enter(gi)}
              onBlur={leave}
              onClick={() => {
                const el = items.current[gi];
                el?.scrollIntoView({ block: 'nearest' });
                el?.focus({ preventScroll: true });
              }}
            >
              {/* 太窄的段只留颜色，数值在提示和读屏标签里 */}
              {g.rttMs / total >= 0.1 ? `+${fmtMs(g.rttMs)}` : ''}
            </button>
          ))}
          {overheadMs > 0.05 && (
            <button
              className={`rib-seg rib-overhead ${hot === OVERHEAD ? 'is-hot' : ''}`}
              style={{ flex: `${overheadMs} 1 0` }}
              aria-label={t('route.segment', { kind: t('est.kind.overhead'), path: t('est.overheadShort'), ms: fmtMs(overheadMs), total: fmtMs(total) })}
              title={`${t('est.kind.overhead')} · ${t('est.overheadShort')}`}
              onMouseEnter={() => enter(OVERHEAD)}
              onMouseLeave={leave}
              onFocus={() => enter(OVERHEAD)}
              onBlur={leave}
              onClick={() => {
                const el = overheadRef.current;
                el?.scrollIntoView({ block: 'nearest' });
                el?.focus({ preventScroll: true });
              }}
            >
              {overheadMs / total >= 0.1 ? `+${fmtMs(overheadMs)}` : ''}
            </button>
          )}
        </div>
      </div>

      <div className="summary-grid">
        <div className="summary-main">
          <span className="summary-label">{t('est.rtt')}</span>
          <span className="summary-value">{fmtMs(total)} ms</span>
        </div>
        <div>
          <span className="summary-label">{t('est.physical')}</span>
          <span className="summary-value dim">{fmtMs(route.rttMs)} ms</span>
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
              ref={(el) => {
                items.current[gi] = el;
              }}
              className={`tl-item tl-${g.kind} ${hot === gi ? 'is-hot' : ''}`}
              tabIndex={0}
              onMouseEnter={() => enter(gi)}
              onMouseLeave={leave}
              onFocus={(e) => e.target === e.currentTarget && enter(gi)}
              onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && leave()}
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
                        <li
                          key={i}
                          tabIndex={0}
                          onMouseEnter={() => onHover([g.start + i, g.start + i])}
                          onFocus={() => onHover([g.start + i, g.start + i])}
                        >
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
        {overheadMs > 0.05 && (
          <li
            ref={overheadRef}
            className={`tl-item tl-overhead ${hot === OVERHEAD ? 'is-hot' : ''}`}
            tabIndex={0}
            onMouseEnter={() => enter(OVERHEAD)}
            onMouseLeave={leave}
            onFocus={() => enter(OVERHEAD)}
            onBlur={leave}
          >
            <div className="tl-head">
              <span className="tl-kind">{t('est.kind.overhead')}</span>
              <span className="tl-rtt">
                +{fmtMs(overheadMs)} ms <span className="tl-cum">{t('est.cumulative', { ms: fmtMs(total) })}</span>
              </span>
            </div>
            <div className="tl-body muted">{t(`est.overhead.${rule}`, { k: RTT_CALIBRATION.k, into: RTT_CALIBRATION.intoChinaMs, out: RTT_CALIBRATION.outOfChinaMs })}</div>
          </li>
        )}
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
