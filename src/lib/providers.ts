import type { ProviderId } from './types.ts';

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  nameZh?: string;
  color: string;
  /** 该厂商自有网络的 ASN，用于判断 RIPE Atlas 锚点是否托管在其机房内。 */
  asns: number[];
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'aws', name: 'AWS', color: '#ff9900', asns: [16509, 14618] },
  { id: 'azure', name: 'Azure', color: '#3b82f6', asns: [8075] },
  { id: 'gcp', name: 'Google Cloud', color: '#22c55e', asns: [15169, 396982, 19527] },
  { id: 'tencent', name: 'Tencent Cloud', nameZh: '腾讯云', color: '#0891b2', asns: [132203, 45090] },
];

export const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p])) as Record<
  ProviderId,
  ProviderInfo
>;
