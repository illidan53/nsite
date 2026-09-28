import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 本地开发时模拟线上的 /geo（线上由 CloudFront Function 根据访问者 IP 返回大致位置）。
 * 这里在服务端用 RIPEstat 查本机公网 IP 的位置，结果缓存到进程结束。
 */
function devGeo(): Plugin {
  let cached: Promise<string> | null = null;
  const lookup = async () => {
    const stat = 'https://stat.ripe.net/data';
    const ip = ((await (await fetch(`${stat}/whats-my-ip/data.json?sourceapp=nsite-dev`)).json()) as { data: { ip: string } }).data.ip;
    const geo = (await (await fetch(`${stat}/maxmind-geo-lite/data.json?resource=${ip}&sourceapp=nsite-dev`)).json()) as {
      data: { located_resources: { locations: { latitude: number; longitude: number; city: string; country: string }[] }[] };
    };
    const loc = geo.data.located_resources[0]?.locations[0];
    return JSON.stringify(loc ? { lat: loc.latitude, lng: loc.longitude, city: loc.city || null, region: null, country: loc.country } : {});
  };
  return {
    name: 'dev-geo',
    configureServer(server) {
      server.middlewares.use('/geo', (_req, res) => {
        cached ??= lookup().catch(() => '{}');
        cached.then((body) => {
          res.setHeader('content-type', 'application/json');
          res.setHeader('cache-control', 'no-store');
          res.end(body);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devGeo()],
  // 本地开发直接用线上的测量 API（站长判定仍按本机公网 IP）。
  server: { proxy: { '/api': { target: 'https://global-network.nphunter.gg', changeOrigin: true } } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
} as Parameters<typeof defineConfig>[0]);
