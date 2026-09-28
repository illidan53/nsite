// 站长判定：CloudFront 写入的访问者地址 + 白名单（精确 IP 或 IPv4 CIDR）。无外部依赖，便于单测。

/** 从 CloudFront-Viewer-Address（"ip:port"，IPv6 形如 "2001:db8::1:443"）取出 IP。 */
export function viewerIp(headers) {
  const v = headers?.['cloudfront-viewer-address'];
  if (!v) return null;
  const i = v.lastIndexOf(':');
  return (i > 0 ? v.slice(0, i) : v).replace(/^\[|\]$/g, '');
}

function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

export function isOwner(ip, allowlist) {
  if (!ip) return false;
  return allowlist.some((entry) => {
    if (!entry.includes('/')) return entry === ip;
    const [base, bits] = entry.split('/');
    const a = ipv4ToInt(base);
    const b = ipv4ToInt(ip);
    const n = Number(bits);
    if (a === null || b === null || !Number.isInteger(n) || n < 0 || n > 32) return false;
    const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
    return ((a & mask) >>> 0) === ((b & mask) >>> 0);
  });
}
