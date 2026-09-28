import { useState } from 'react';
import { PROVIDER_BY_ID } from '../lib/providers.ts';
import type { Region } from '../lib/types.ts';

export interface RankedRegion {
  region: Region;
  distanceKm: number;
  rttMs: number;
}

interface Props {
  items: RankedRegion[];
  onSelect: (region: Region) => void;
}

const PAGE = 12;

export function fmtMs(ms: number) {
  return Math.abs(ms) < 10 ? ms.toFixed(1) : Math.round(ms).toString();
}

export function fmtKm(km: number) {
  return km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString();
}

export default function RegionList({ items, onSelect }: Props) {
  const [limit, setLimit] = useState(PAGE);
  if (!items.length) return <p className="muted">没有符合筛选条件的数据中心。</p>;
  const max = Math.max(...items.slice(0, limit).map((i) => i.rttMs));

  return (
    <>
      <ol className="region-list">
        {items.slice(0, limit).map(({ region, distanceKm, rttMs }) => {
          const p = PROVIDER_BY_ID[region.provider];
          const same = region.anchors.some((a) => a.sameProvider);
          return (
            <li key={region.id}>
              <button className="region-row" onClick={() => onSelect(region)}>
                <span className="dot" style={{ background: p.color }} />
                <span className="region-main">
                  <span className="region-title">
                    <span className="region-name">
                      <b style={{ color: p.color }}>{p.name}</b> {region.name}
                    </span>
                    {region.anchors.length > 0 && (
                      <span className={`badge ${same ? 'badge-live' : 'badge-proxy'}`} title={same ? '有托管在该云网络内的 RIPE Atlas 锚点' : '有同城 RIPE Atlas 锚点可作参考'}>
                        {same ? '同网实测' : '同城实测'}
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
        })}
      </ol>
      {items.length > limit && (
        <button className="link-button" onClick={() => setLimit(limit + PAGE)}>
          再显示 {Math.min(PAGE, items.length - limit)} 个（共 {items.length}）
        </button>
      )}
    </>
  );
}
