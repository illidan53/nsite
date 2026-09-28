import type { ProviderId } from './types.ts';

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  color: string;
  /** 该厂商自有网络的 ASN，用于判断 RIPE Atlas 锚点是否托管在其机房内。 */
  asns: number[];
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'aws', name: 'AWS', color: '#ff9900', asns: [16509, 14618] },
  { id: 'azure', name: 'Azure', color: '#3b82f6', asns: [8075] },
  { id: 'gcp', name: 'Google Cloud', color: '#22c55e', asns: [15169, 396982, 19527] },
  { id: 'alibaba', name: '阿里云', color: '#ff5b1f', asns: [45102, 37963, 45103] },
  { id: 'tencent', name: '腾讯云', color: '#22d3ee', asns: [132203, 45090] },
  { id: 'oci', name: 'Oracle Cloud', color: '#f43f5e', asns: [31898] },
  { id: 'digitalocean', name: 'DigitalOcean', color: '#93c5fd', asns: [14061] },
  { id: 'vultr', name: 'Vultr', color: '#a78bfa', asns: [20473] },
  { id: 'linode', name: 'Akamai (Linode)', color: '#6ee7b7', asns: [63949] },
  { id: 'ovh', name: 'OVHcloud', color: '#818cf8', asns: [16276] },
  { id: 'hetzner', name: 'Hetzner', color: '#f472b6', asns: [24940, 213230] },
];

export const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p])) as Record<
  ProviderId,
  ProviderInfo
>;
