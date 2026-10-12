import { describe, expect, it } from 'vitest';
import { fitAltitude, placeLayout, routeCamera } from './layout.ts';

describe('placeLayout', () => {
  it('docks the route card on the right of landscape screens', () => {
    expect(placeLayout(1440, 900, 'route', 'peek')).toMatchObject({ dock: 'side', cardW: 518, offset: [-267, 0] });
    expect(placeLayout(1280, 800, 'route', 'peek')).toMatchObject({ cardW: 461, offset: [-238.5, 0] });
    expect(placeLayout(1024, 768, 'route', 'peek')).toMatchObject({ cardW: 400, offset: [-208, 0] });
    expect(placeLayout(800, 600, 'route', 'peek')).toMatchObject({ cardW: 360, offset: [-188, 0] });
  });

  it('uses a bottom sheet on phones and portrait tablets', () => {
    expect(placeLayout(768, 1024, 'route', 'peek')).toMatchObject({ dock: 'bottom', sheetPx: 451, offset: [0, -225.5] });
    expect(placeLayout(375, 812, 'route', 'peek')).toMatchObject({ mobile: true, sheetPx: 357, offset: [0, -178.5] });
    // 全屏抽屉不改偏移
    expect(placeLayout(375, 812, 'route', 'full')).toMatchObject({ sheetPx: 715, offset: [0, -178.5] });
  });

  it('keeps the clicked point in the strip above the mobile overview sheet', () => {
    expect(placeLayout(375, 812, 'overview', 'peek').offset).toEqual([0, -350]);
    expect(placeLayout(1440, 900, 'overview', 'peek').offset).toEqual([0, 0]);
  });

  it('leaves the globe centred when idle or minimized, and keeps the IP panel offset', () => {
    expect(placeLayout(1440, 900, 'idle', 'peek').offset).toEqual([0, 0]);
    expect(placeLayout(1440, 900, 'minimized', 'peek').offset).toEqual([0, 0]);
    expect(placeLayout(1440, 900, 'ips', 'peek').offset).toEqual([-220, 0]);
    expect(placeLayout(375, 812, 'ips', 'peek').offset[1]).toBeCloseTo(-227.36);
  });
});

describe('routeCamera', () => {
  const nj = { lat: 40.72, lng: -74.07 };
  const ashburn = { lat: 39.04, lng: -77.49 };
  const shanghai = { lat: 31.23, lng: 121.47 };
  const frankfurt = { lat: 50.11, lng: 8.68 };
  const sydney = { lat: -33.87, lng: 151.21 };
  const side = placeLayout(1440, 900, 'route', 'peek');
  const phone = placeLayout(375, 812, 'route', 'peek');

  it('keeps the distance-based framing when the route already fits', () => {
    expect(routeCamera(nj, ashburn, side.free, 900).altitude).toBeCloseTo(1.4);
    expect(routeCamera(shanghai, frankfurt, side.free, 900).altitude).toBeCloseTo(2.86, 1);
  });

  it('pulls back so long routes fit above a phone sheet, never past 4', () => {
    const a = routeCamera(shanghai, frankfurt, phone.free, 812).altitude;
    expect(a).toBeGreaterThan(2.9);
    expect(a).toBeLessThanOrEqual(4);
    expect(routeCamera(nj, sydney, phone.free, 812).altitude).toBeLessThanOrEqual(4);
  });

  it('needs less altitude as the free area grows', () => {
    expect(fitAltitude(8000, 90, { w: 800, h: 600 }, 900)).toBeLessThan(fitAltitude(8000, 90, { w: 400, h: 600 }, 900));
  });
});
