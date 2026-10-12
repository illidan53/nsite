import type { RefObject } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import { providerName, regionName } from '../lib/names.ts';
import type { Place } from '../lib/places.ts';
import { PROVIDER_BY_ID } from '../lib/providers.ts';
import Flag from './Flag.tsx';
import { fmtMs, type RankedRegion } from './RegionList.tsx';

interface Props {
  place: Place | null;
  onLand: boolean;
  /** 选择器里排第一的数据中心（按厂商筛选，不受搜索词影响）。 */
  lowest: RankedRegion | undefined;
  /** 按哪种延迟排的（实测排序时显示实测值）。 */
  useMine: boolean;
  openRef: RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
  onClose: () => void;
}

/** 选择窗口收起后留在底部的小条：地点 · 最低延迟的数据中心 · 展开 / 关闭。地球此时可以自由操作。 */
export default function MiniPill({ place, onLand, lowest, useMine, openRef, onOpen, onClose }: Props) {
  const { lang, t, pick } = useI18n();
  const country = place?.country;
  const name = place?.admin1
    ? pick(place.admin1.name, place.admin1.nameZh)
    : country
      ? pick(country.name, country.nameZh)
      : t(onLand ? 'place.unknown' : 'place.ocean');
  const ms = lowest ? (useMine && lowest.mineMs !== null ? lowest.mineMs : lowest.rttMs) : null;
  return (
    <div className="mini-pill" role="group" aria-label={t('pill.label', { place: name })} data-label-avoid>
      <button ref={openRef} className="pill-main" onClick={onOpen}>
        {country && <Flag iso2={country.iso2} title={country.name} />}
        <b className="pill-place">{name}</b>
        {lowest && ms !== null && (
          <span className="pill-lowest">
            ·{' '}
            {t('pill.lowest', {
              dc: `${providerName(PROVIDER_BY_ID[lowest.region.provider], lang)} ${regionName(lowest.region, lang)}`,
              ms: fmtMs(ms),
            })}
          </span>
        )}
        <span className="pill-open">{t('pill.open')} ▴</span>
      </button>
      <button className="icon-button" onClick={onClose} aria-label={t('place.close')}>
        ×
      </button>
    </div>
  );
}
