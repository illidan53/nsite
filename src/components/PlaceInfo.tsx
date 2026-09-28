import { geoBounds, geoContains } from 'd3-geo';
import { useEffect, useState, type ReactNode } from 'react';
import { connectedProbesInBox, countConnectedProbes } from '../lib/atlas.ts';
import { koppenAt, type KoppenClass } from '../lib/climate.ts';
import { useI18n, type Lang } from '../lib/i18n.tsx';
import type { Place } from '../lib/places.ts';

interface Props {
  origin: { lat: number; lng: number };
  place: Place | null;
}

function fmtPop(n: number, lang: Lang) {
  if (lang === 'zh') {
    if (n >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`;
    if (n >= 1e6) return `${Math.round(n / 1e4).toLocaleString()} 万`;
    if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`;
    return n.toLocaleString();
  }
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} K`;
  return n.toLocaleString();
}

type TzLookup = (lat: number, lng: number) => string;
let tzLookup: Promise<TzLookup> | null = null;
const loadTz = () => (tzLookup ??= import('@photostructure/tz-lookup').then((m) => (m.default ?? m) as TzLookup));

function tzText(zone: string, lang: Lang) {
  const now = new Date();
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')
      ?.value.replace('GMT', 'UTC') ?? '';
  const time = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  return { offset: offset === 'UTC' ? 'UTC+0' : offset, time };
}

/** 点击位置的概况：省、国家（带国旗）、时区、RIPE Atlas 在线探针数、人口、气候。 */
export default function PlaceInfo({ origin, place }: Props) {
  const { lang, t, pick } = useI18n();
  const [zone, setZone] = useState<string | null>(null);
  const [probes, setProbes] = useState<{ province: number | null; country: number } | null>(null);
  const [climate, setClimate] = useState<KoppenClass | null | undefined>(undefined);
  const [, tick] = useState(0);
  const country = place?.country ?? null;
  const admin1 = place?.admin1 ?? null;
  const feature = place?.admin1Feature ?? null;

  useEffect(() => {
    let live = true;
    setZone(null);
    setClimate(undefined);
    loadTz()
      .then((lookup) => live && setZone(lookup(origin.lat, origin.lng)))
      .catch(() => {});
    koppenAt(origin.lat, origin.lng)
      .then((c) => live && setClimate(c))
      .catch(() => live && setClimate(null));
    return () => {
      live = false;
    };
  }, [origin.lat, origin.lng]);

  useEffect(() => {
    let live = true;
    setProbes(null);
    const iso2 = country?.iso2;
    if (!iso2 || !/^[A-Z]{2}$/.test(iso2)) return;
    // 全国总数只取 count；省内数量先按省的外接矩形查，再用省界精确过滤（跨 180° 经线时拆成两段）。
    const inProvince = async () => {
      if (!feature) return null;
      const [[w, s], [e, n]] = geoBounds(feature);
      const boxes: [[number, number], [number, number]][] = w <= e ? [[[w, s], [e, n]]] : [[[w, s], [180, n]], [[-180, s], [e, n]]];
      const lists = await Promise.all(boxes.map((b) => connectedProbesInBox(iso2, b)));
      return lists.flat().filter((p) => geoContains(feature, [p.lng, p.lat])).length;
    };
    Promise.all([inProvince(), countConnectedProbes(iso2)])
      .then(([province, total]) => live && setProbes({ province, country: total }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [country?.iso2, feature]);

  // 当地时间每分钟刷新
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const tz = zone ? tzText(zone, lang) : null;
  const rows: [string, ReactNode][] = [
    [t('info.province'), admin1 ? `${pick(admin1.name, admin1.nameZh)}${lang === 'zh' && admin1.nameZh ? ` · ${admin1.name}` : ''}` : '—'],
    [
      t('info.country'),
      country ? `${pick(country.name, country.nameZh)}${lang === 'zh' && country.nameZh ? ` · ${country.name}` : ''}` : '—',
    ],
    [t('info.timezone'), tz ? `${zone} · ${tz.offset} · ${t('info.localTime', { time: tz.time })}` : '…'],
    [
      t('info.probes'),
      !country
        ? '—'
        : probes
          ? probes.province !== null
            ? t('info.probesValue', { province: probes.province, country: probes.country })
            : t('info.probesCountry', { country: probes.country })
          : '…',
    ],
    [
      t('info.population'),
      [
        admin1?.pop ? t('info.popProvince', { n: fmtPop(admin1.pop, lang), year: admin1.popYear ?? '?' }) : null,
        country?.pop ? t('info.popCountry', { n: fmtPop(country.pop, lang), year: country.popYear ?? '?' }) : null,
      ]
        .filter(Boolean)
        .join(' · ') || '—',
    ],
    [t('info.climate'), climate === undefined ? '…' : climate ? `${climate.code} · ${climate[lang]}` : '—'],
  ];

  return (
    <div className="place-info">
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted place-info-src">{t('info.sources')}</p>
    </div>
  );
}
