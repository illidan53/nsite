import { LandMask } from './geo.ts';
import { loadCountries, prefetchAdmin1, type CountryFeature } from './places.ts';
import { buildRouteGraph, type RouteGraph } from './routing.ts';
import type { NetworkData } from './types.ts';

export interface AppData {
  network: NetworkData;
  countries: CountryFeature[];
  graph: RouteGraph;
}

export async function loadAppData(): Promise<AppData> {
  const [network, landBuf, countries] = await Promise.all([
    fetch('/data/network.json').then((r) => {
      if (!r.ok) throw new Error('缺少 /data/network.json，请先运行 npm run data');
      return r.json() as Promise<NetworkData>;
    }),
    fetch('/data/landmask.bin').then((r) => r.arrayBuffer()),
    loadCountries(),
  ]);
  const graph = buildRouteGraph(network, new LandMask(new Uint8Array(landBuf)));
  prefetchAdmin1();
  return { network, countries, graph };
}
