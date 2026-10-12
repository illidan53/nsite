import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import type { Place } from '../lib/places.ts';
import Flag from './Flag.tsx';
import PlaceInfo from './PlaceInfo.tsx';
import { SourceLegend } from './Sources.tsx';

interface Props {
  origin: { lat: number; lng: number };
  place: Place | null;
  onLand: boolean;
  mobile: boolean;
  /** 右栏（窄屏时在概况下面）的数据中心选择器。 */
  chooser: ReactNode;
  onMinimize: () => void;
  onClose: () => void;
}

export function fmtCoord(lat: number, lng: number) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'}`;
}

/** 选择窗口的内容：标题（地点）、左栏概况卡片 + 图例 + 出处，右栏数据中心选择器。 */
export default function PlaceOverview({ origin, place, onLand, mobile, chooser, onMinimize, onClose }: Props) {
  const { lang, t, pick } = useI18n();
  const country = place?.country;
  const admin1 = place?.admin1;
  return (
    <>
      {mobile && <span className="sheet-handle" aria-hidden="true" />}
      <header className="fw-head">
        <div className="fw-head-text">
          <h2 className="fw-title place-title" id="fw-title" tabIndex={-1}>
            {country ? (
              <>
                {admin1 && <span>{pick(admin1.name, admin1.nameZh)}</span>}
                <span className={admin1 ? 'place-country' : ''}>
                  {pick(country.name, country.nameZh)}
                  <Flag iso2={country.iso2} title={country.name} />
                </span>
              </>
            ) : (
              <span>{t(onLand ? 'place.unknown' : 'place.ocean')}</span>
            )}
          </h2>
          <p className="place-sub" id="fw-sub">
            {country && lang === 'zh' && (
              <>
                {admin1 ? `${admin1.name}, ` : ''}
                {country.name} ·{' '}
              </>
            )}
            {admin1?.type ? `${admin1.type} · ` : ''}
            {fmtCoord(origin.lat, origin.lng)}
          </p>
        </div>
        <div className="fw-actions">
          <button className="icon-button" onClick={onMinimize} aria-label={t('fw.minimize')} title={t('fw.minimize')}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="icon-button" onClick={onClose} aria-label={t('place.close')} title={t('place.close')}>
            ×
          </button>
        </div>
      </header>
      {/* DOM 顺序 = 窄窗口里的阅读顺序（概况 → 选择器 → 图例和出处）；宽窗口用网格把图例放回左栏 */}
      <div className="fw-body">
        <section className="fw-facts" aria-label={t('fw.about')}>
          <h3 className="aside-title">{t('fw.about')}</h3>
          <PlaceInfo origin={origin} place={place} />
        </section>
        <div className="fw-main">{chooser}</div>
        <div className="fw-ref">
          <details className="legend-details" open={!mobile}>
            <summary>{t('src.legendTitle')}</summary>
            <SourceLegend />
          </details>
          <p className="muted place-info-src">{t('info.sources')}</p>
        </div>
      </div>
    </>
  );
}
