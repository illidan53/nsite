// 站长实测 API（/api/*，见 api/index.mjs）与 RIPE Atlas 公开结果读取。

import { parseTraceroute, type TraceResult } from './atlas.ts';
import type { Place } from './places.ts';

export interface MeasureProbe {
  id: number;
  lat: number;
  lng: number;
  asn: number;
  country: string;
  anchor: boolean;
  distanceKm: number;
}

export interface Measurement {
  createdAt: string;
  msmId: number;
  target: string;
  protocol: 'ICMP' | 'TCP';
  kind: 'public' | 'anchor-same' | 'anchor-proxy';
  probes: MeasureProbe[];
  origin: { lat: number; lng: number; country: string; cell: string };
}

export interface Whoami {
  owner: boolean;
  configured: boolean;
}

/** 起点地区：优先用省/州（ISO 3166-2，如 US-NJ），否则用国家代码。 */
export function cellOf(place: Place | null): { cell: string; country: string } | null {
  const country = place?.country?.iso2;
  if (!country || !/^[A-Z]{2}$/.test(country)) return null;
  const iso = place?.admin1?.iso?.toUpperCase();
  return { cell: iso && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(iso) ? iso : country, country };
}

export async function whoami(): Promise<Whoami | null> {
  try {
    const res = await fetch('/api/whoami', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as Whoami;
  } catch {
    return null;
  }
}

export async function listMeasurements(pk: string, signal?: AbortSignal): Promise<Measurement[]> {
  const res = await fetch(`/api/measurements?pk=${encodeURIComponent(pk)}`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`${res.status}`);
  return ((await res.json()) as { items: Measurement[] }).items;
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function startMeasurement(payload: {
  lat: number;
  lng: number;
  country: string;
  cell: string;
  region: string;
}): Promise<Measurement> {
  const body = JSON.stringify(payload);
  const res = await fetch('/api/measure', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // CloudFront 用 OAC 签名转发到 Lambda 函数 URL 时，POST 需要带上请求体的 SHA-256。
      'x-amz-content-sha256': await sha256Hex(body),
    },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Measurement & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  return data;
}

/** 读取一次性测量的结果（RIPE Atlas 公开 API，无需 key）。 */
export async function measurementResults(msmId: number, signal?: AbortSignal): Promise<TraceResult[]> {
  const res = await fetch(`https://atlas.ripe.net/api/v2/measurements/${msmId}/results/?format=json`, { signal });
  if (!res.ok) throw new Error(`${res.status}`);
  return ((await res.json()) as Parameters<typeof parseTraceroute>[0][]).map(parseTraceroute);
}
