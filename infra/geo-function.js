// CloudFront Function（cloudfront-js-2.0，viewer-request）：返回访问者的大致位置。
// 位置来自 CloudFront 根据访问者 IP 附加的 CloudFront-Viewer-* 请求头（/geo 行为的源请求策略里启用）。
// 直接在边缘生成响应，不回源、不缓存、不记录。
function handler(event) {
  var headers = event.request.headers;
  function get(name) {
    var h = headers[name];
    if (!h || !h.value) return null;
    try {
      return decodeURIComponent(h.value);
    } catch (e) {
      return h.value;
    }
  }
  var lat = parseFloat(get('cloudfront-viewer-latitude'));
  var lng = parseFloat(get('cloudfront-viewer-longitude'));
  var body = {
    lat: isNaN(lat) ? null : lat,
    lng: isNaN(lng) ? null : lng,
    city: get('cloudfront-viewer-city'),
    region: get('cloudfront-viewer-country-region-name'),
    country: get('cloudfront-viewer-country'),
  };
  return {
    statusCode: 200,
    statusDescription: 'OK',
    headers: {
      'content-type': { value: 'application/json; charset=utf-8' },
      'cache-control': { value: 'no-store' },
    },
    body: { encoding: 'text', data: JSON.stringify(body) },
  };
}
