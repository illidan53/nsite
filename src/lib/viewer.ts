// 访问者的大致位置：线上由 CloudFront Function（/geo）根据 CloudFront 的 IP 地理定位请求头返回，
// 本地开发由 vite.config.ts 里的中间件模拟。不调用第三方定位服务。

export interface ViewerLocation {
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  country: string | null;
}

export async function fetchViewerLocation(signal?: AbortSignal): Promise<ViewerLocation | null> {
  try {
    const res = await fetch('/geo', { cache: 'no-store', signal });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const d = (await res.json()) as Partial<ViewerLocation>;
    if (typeof d.lat !== 'number' || typeof d.lng !== 'number' || !Number.isFinite(d.lat) || !Number.isFinite(d.lng)) return null;
    return { lat: d.lat, lng: d.lng, city: d.city ?? null, region: d.region ?? null, country: d.country ?? null };
  } catch {
    return null;
  }
}

export const viewerLabel = (v: ViewerLocation) => [v.city, v.region, v.country].filter(Boolean).join(', ');
