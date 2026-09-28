import type { LngLat } from './geo.ts';

export type ProviderId =
  | 'aws'
  | 'azure'
  | 'gcp'
  | 'oci'
  | 'alibaba'
  | 'tencent'
  | 'digitalocean'
  | 'vultr'
  | 'linode'
  | 'ovh'
  | 'hetzner';

/** 与某个云区域同城（或就在该云网络内）的 RIPE Atlas 锚点。 */
export interface AnchorRef {
  id: number;
  probeId: number;
  fqdn: string;
  asn: number;
  company: string;
  city: string;
  lat: number;
  lng: number;
  distanceKm: number;
  /** 锚点就托管在该云厂商的网络（ASN 匹配）里，路径最后一段也是真实的。 */
  sameProvider: boolean;
  /** 持续运行的 IPv4 traceroute 测量：anchoring mesh（其它锚点发起）和 anchoring probes（普通探针发起）。 */
  traceroute: number[];
  ping: number[];
}

export interface Region {
  id: string;
  provider: ProviderId;
  code: string;
  name: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  anchors: AnchorRef[];
}

export interface Cable {
  id: string;
  name: string;
  color: string;
  planned: boolean;
  rfsYear: number | null;
  /** TeleGeography 公布的总长度。 */
  lengthKm: number | null;
  /** 地图上绘制路径的总长度，用于把官方长度按比例摊到各段。 */
  drawnKm: number;
  owners: string;
  url: string | null;
  landingPoints: string[];
  lines: LngLat[][];
}

export interface LandingPoint {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
}

/** 陆地骨干的枢纽城市（Natural Earth populated places）。 */
export interface Hub {
  id: string;
  name: string;
  nameZh: string;
  country: string;
  lat: number;
  lng: number;
}

/** 预计算的陆地光缆近似连接：节点 key 列表 + [a, b, 大圆 km]。 */
export interface LandGraph {
  nodes: string[];
  edges: [number, number, number][];
}

/** 全部在线锚点的探针位置，用于挑选 anchoring mesh 测量里离点击位置最近的发起方。 */
export interface AnchorProbe {
  probeId: number;
  lat: number;
  lng: number;
  city: string;
  country: string;
  asn: number;
}

export interface NetworkData {
  regions: Region[];
  cables: Cable[];
  landingPoints: LandingPoint[];
  hubs: Hub[];
  landGraph: LandGraph;
  anchorProbes: AnchorProbe[];
  meta: { builtAt: string; sources: { name: string; url: string; license: string }[] };
}
