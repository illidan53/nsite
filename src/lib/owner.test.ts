import { describe, expect, it } from 'vitest';
// @ts-expect-error 纯 JS 模块（Lambda 代码），没有类型声明
import { isOwner, viewerIp } from '../../api/owner.mjs';

describe('viewerIp', () => {
  it('strips the port from IPv4 and IPv6 viewer addresses', () => {
    expect(viewerIp({ 'cloudfront-viewer-address': '203.0.113.19:51234' })).toBe('203.0.113.19');
    expect(viewerIp({ 'cloudfront-viewer-address': '2001:db8::1:443' })).toBe('2001:db8::1');
    expect(viewerIp({})).toBeNull();
  });
});

describe('isOwner', () => {
  it('matches exact IPs and IPv4 CIDR ranges only', () => {
    expect(isOwner('203.0.113.19', ['203.0.113.19'])).toBe(true);
    expect(isOwner('203.0.113.20', ['203.0.113.19'])).toBe(false);
    expect(isOwner('203.0.113.200', ['203.0.113.0/24'])).toBe(true);
    expect(isOwner('203.0.114.1', ['203.0.113.0/24'])).toBe(false);
    expect(isOwner(null, ['203.0.113.19'])).toBe(false);
    expect(isOwner('203.0.113.19', [])).toBe(false);
    expect(isOwner('203.0.113.19', ['203.0.113.0/99'])).toBe(false);
  });
});
