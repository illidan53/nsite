import { useMemo, useState } from 'react';
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

const KIND_LABEL: Record<Segment['kind'], string> = { access: '接入网', land: '陆地光缆（估）', sub: '海缆' };

export default function RouteEstimate({ route, onHover }: Props) {
  const groups = useMemo(() => (route ? groupSegments(route.segments) : []), [route]);
  const [open, setOpen] = useState<number | null>(null);

  if (!route) {
    return <p className="muted">在当前数据里找不到连到这个数据中心的物理路径（可能是孤立海岛或数据缺失）。</p>;
  }

  const subCount = route.segments.filter((s) => s.kind === 'sub').length;
  return (
    <div className="route-estimate">
      <div className="summary-grid">
        <div>
          <span className="summary-label">估算 RTT</span>
          <span className="summary-value">{fmtMs(route.rttMs)} ms</span>
        </div>
        <div>
          <span className="summary-label">直线理论下限</span>
          <span className="summary-value dim">{fmtMs(route.floorRttMs)} ms</span>
        </div>
        <div>
          <span className="summary-label">光纤路径</span>
          <span className="summary-value dim">{fmtKm(route.km)} km</span>
        </div>
        <div>
          <span className="summary-label">经过海缆</span>
          <span className="summary-value dim">{subCount} 条</span>
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
                <span className="tl-kind">{KIND_LABEL[g.kind]}</span>
                <span className="tl-rtt">
                  +{fmtMs(g.rttMs)} ms <span className="tl-cum">累计 {fmtMs(g.cumulativeMs)}</span>
                </span>
              </div>
              {g.kind === 'access' ? (
                <div className="tl-body muted">家宽/移动网络最后一公里，按 {ACCESS_RTT_MS} ms 往返计（假设值）</div>
              ) : (
                <div className="tl-body">
                  <div className="tl-path">
                    {first.from} → {last.to}
                  </div>
                  <div className="tl-meta">
                    {fmtKm(g.km)} km
                    {cable && (
                      <>
                        {' · '}
                        <a href={`https://www.submarinecablemap.com/submarine-cable/${cable.id}`} target="_blank" rel="noreferrer">
                          {cable.name}
                        </a>
                        {cable.rfsYear ? ` · ${cable.rfsYear} 年投产` : ''}
                      </>
                    )}
                    {expandable && (
                      <>
                        {' · '}
                        <button className="link-button inline" onClick={() => setOpen(open === gi ? null : gi)}>
                          {open === gi ? '收起' : `经 ${g.segments.length - 1} 个节点`}
                        </button>
                      </>
                    )}
                  </div>
                  {cable?.owners && <div className="tl-owners">运营方：{cable.owners}</div>}
                  {expandable && open === gi && (
                    <ol className="tl-hops">
                      {g.segments.map((s, i) => (
                        <li key={i} onMouseEnter={() => onHover([g.start + i, g.start + i])}>
                          <span>
                            {s.from} → {s.to}
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
        <summary>估算方法与局限</summary>
        <ul>
          <li>光在光纤中约 {FIBER_KM_PER_MS.toFixed(0)} km/ms（折射率 1.468），RTT = 2 × 路径长度 ÷ 光速。</li>
          <li>海缆走向来自 TeleGeography，按官方公布长度对绘制路径做比例校正。</li>
          <li>陆地段没有公开的全球光缆走向数据，用沿陆地的大圆距离 × {LAND_INFLATION} 近似，经过 Natural Earth 城市与登陆站。</li>
          <li>这是“物理上最短可行路径”，实际路由取决于运营商互联、BGP 策略和国际出口，往往更绕。真实路径请看「RIPE Atlas 实测」。</li>
        </ul>
      </details>
    </div>
  );
}
