// 点击位置 → 国家 / 省级行政区（离线，Natural Earth）。

import { geoBounds, geoContains } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';

export interface CountryProps {
  name: string;
  nameZh: string;
  iso2: string;
  iso3: string;
  continent: string;
  pop: number | null;
  popYear: number | null;
}

export interface Admin1Props {
  name: string;
  nameZh: string | null;
  iso: string;
  adm0: string;
  type: string | null;
  labelLat: number | null;
  labelLng: number | null;
  /** 面积（km²）。 */
  area: number | null;
  /** 人口（Wikidata）。 */
  pop: number | null;
  popYear: number | null;
}

export type CountryFeature = Feature<Geometry, CountryProps>;
export type Admin1Feature = Feature<Geometry, Admin1Props>;

interface Indexed<F> {
  f: F;
  bounds: [[number, number], [number, number]];
}

function index<F extends Feature>(features: F[]): Indexed<F>[] {
  return features.map((f) => ({ f, bounds: geoBounds(f) as [[number, number], [number, number]] }));
}

function inBounds([[x0, y0], [x1, y1]]: [[number, number], [number, number]], lng: number, lat: number) {
  if (lat < y0 || lat > y1) return false;
  // geoBounds 在跨 180° 经线时 x0 > x1
  return x0 <= x1 ? lng >= x0 && lng <= x1 : lng >= x0 || lng <= x1;
}

function find<F extends Feature>(items: Indexed<F>[], lng: number, lat: number): F | null {
  for (const { f, bounds } of items) {
    if (inBounds(bounds, lng, lat) && geoContains(f, [lng, lat])) return f;
  }
  return null;
}

export async function loadCountries(): Promise<CountryFeature[]> {
  const topo = (await (await fetch('/data/countries.topo.json')).json()) as Topology;
  return (feature(topo, topo.objects.countries) as FeatureCollection<Geometry, CountryProps>).features;
}

let countryIndex: Indexed<CountryFeature>[] | null = null;
let admin1Index: Promise<Map<string, Indexed<Admin1Feature>[]>> | null = null;

function loadAdmin1() {
  admin1Index ??= fetch('/data/admin1.topo.json')
    .then((r) => r.json() as Promise<Topology>)
    .then((topo) => {
      const fc = feature(topo, topo.objects.admin1) as FeatureCollection<Geometry, Admin1Props>;
      const byCountry = new Map<string, Indexed<Admin1Feature>[]>();
      for (const item of index(fc.features)) {
        const list = byCountry.get(item.f.properties.adm0) ?? [];
        list.push(item);
        byCountry.set(item.f.properties.adm0, list);
      }
      return byCountry;
    });
  return admin1Index;
}

export interface Place {
  country: CountryProps | null;
  admin1: Admin1Props | null;
  /** 省级多边形（统计省内探针数用）。 */
  admin1Feature?: Admin1Feature | null;
}

export function lookupCountry(countries: CountryFeature[], lat: number, lng: number): CountryProps | null {
  countryIndex ??= index(countries);
  return find(countryIndex, lng, lat)?.properties ?? null;
}

export async function lookupPlace(countries: CountryFeature[], lat: number, lng: number): Promise<Place> {
  const country = lookupCountry(countries, lat, lng);
  if (!country) return { country: null, admin1: null };
  const byCountry = await loadAdmin1();
  const admin1Feature = find(byCountry.get(country.iso3) ?? [], lng, lat);
  return { country, admin1: admin1Feature?.properties ?? null, admin1Feature };
}

/** 预加载省级数据（体积较大，首屏之后再取）。 */
export function prefetchAdmin1() {
  void loadAdmin1();
}

/** 按国家（ADM0_A3）分组的省级行政区，供拉近时在地球上展开显示。 */
export async function admin1ByCountry(): Promise<Map<string, Admin1Feature[]>> {
  const byCountry = await loadAdmin1();
  return new Map([...byCountry].map(([k, list]) => [k, list.map((x) => x.f)]));
}
