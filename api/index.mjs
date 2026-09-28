// nsite API（AWS Lambda，经 CloudFront /api/* 访问，函数 URL 只允许 CloudFront 通过 OAC 调用）。
//
//   GET  /api/whoami                  当前访问者是否为站长（来源 IP 在白名单内）
//   GET  /api/measurements?pk=...     某“起点地区 | 数据中心”最近的站长实测（公开可读）
//   POST /api/measure                 站长专用：用个人 RIPE Atlas 账号，从点击所在国家的探针向该数据中心的公开地址发起 traceroute
//
// 环境变量：TABLE、RIPE_ATLAS_KEY、OWNER_IPS（逗号分隔，支持 IPv4 CIDR）、DAILY_LIMIT、SITE_ORIGIN。

import { DynamoDBClient, PutItemCommand, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { isOwner, viewerIp } from './owner.mjs';

const ddb = new DynamoDBClient({});
const TABLE = process.env.TABLE;
const KEY = process.env.RIPE_ATLAS_KEY || '';
const OWNER_IPS = (process.env.OWNER_IPS || '').split(',').map((s) => s.trim()).filter(Boolean);
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 50);
const SITE = process.env.SITE_ORIGIN;
const ATLAS = 'https://atlas.ripe.net/api/v2';
const PROBES_PER_MEASUREMENT = 3;
// 被测云厂商自己网络里的探针代表不了当地用户，不用（与 src/lib/providers.ts 的 ASN 保持一致）。
const CLOUD_ASNS = new Set([16509, 14618, 8075, 15169, 396982, 19527, 132203, 45090]);

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

// ---------------------------------------------------------------- 站点数据（区域、公开测试目标），冷启动时从站点拉取

let siteData = null;
async function loadSiteData() {
  if (siteData) return siteData;
  const [network, targets] = await Promise.all([
    fetch(`${SITE}/data/network.json`).then((r) => r.json()),
    fetch(`${SITE}/data/targets.json`).then((r) => r.json()),
  ]);
  siteData = {
    regions: new Map(network.regions.map((r) => [r.id, r])),
    targets: new Map(targets.targets.map((t) => [t.region, t])),
  };
  return siteData;
}

/** 测量目标：只用该区域的公开测试地址。没有公开地址的区域不测，锚点数据另有“锚点参考”一栏，不和站长实测混在一起。 */
function targetFor(region, targets) {
  const t = targets.get(region.id);
  return t ? { host: t.host, protocol: t.method === 'icmp' ? 'ICMP' : 'TCP', kind: 'public' } : null;
}

// ---------------------------------------------------------------- RIPE Atlas

const toRad = (d) => (d * Math.PI) / 180;
function haversineKm(lat1, lng1, lat2, lng2) {
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function atlas(path, init) {
  const res = await fetch(`${ATLAS}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Key ${KEY}`, ...init?.headers },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    // RIPE Atlas 的 400 通常是笼统的 detail + 具体的 errors[]，两者都带上。
    const specific = (body?.error?.errors ?? [])
      .map((e) => [e.source?.pointer, e.detail].filter(Boolean).join(': '))
      .filter(Boolean)
      .join('; ');
    const detail = [body?.error?.detail, specific].filter(Boolean).join(' — ') || text.slice(0, 300);
    const err = new Error(`RIPE Atlas ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

/** 点击所在国家里、离点击处最近的在线探针。 */
async function pickProbes(lat, lng, country) {
  for (const radius of [300, 1000, 3000]) {
    const q = new URLSearchParams({
      radius: `${lat.toFixed(4)},${lng.toFixed(4)}:${radius}`,
      status: '1',
      country_code: country,
      page_size: '100',
      fields: 'id,geometry,asn_v4,country_code,is_anchor',
    });
    const d = await atlas(`/probes/?${q}`);
    const probes = d.results
      .filter((p) => p.geometry && p.asn_v4 && !CLOUD_ASNS.has(p.asn_v4))
      .map((p) => ({
        id: p.id,
        lat: p.geometry.coordinates[1],
        lng: p.geometry.coordinates[0],
        asn: p.asn_v4,
        country: p.country_code,
        anchor: p.is_anchor,
        distanceKm: Math.round(haversineKm(lat, lng, p.geometry.coordinates[1], p.geometry.coordinates[0])),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
    // 同一 ASN 只取最近的一个，让起点覆盖不同运营商
    const picked = [];
    const seen = new Set();
    for (const p of probes) {
      if (seen.has(p.asn)) continue;
      seen.add(p.asn);
      picked.push(p);
      if (picked.length === PROBES_PER_MEASUREMENT) break;
    }
    for (const p of probes) {
      if (picked.length >= PROBES_PER_MEASUREMENT) break;
      if (!picked.includes(p)) picked.push(p);
    }
    if (picked.length) return picked;
  }
  return [];
}

// ---------------------------------------------------------------- 每日额度

async function refundQuota() {
  const day = new Date().toISOString().slice(0, 10);
  await ddb
    .send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { pk: { S: `quota#${day}` }, createdAt: { S: day } },
        UpdateExpression: 'ADD n :minus',
        ExpressionAttributeValues: { ':minus': { N: '-1' } },
      }),
    )
    .catch((err) => console.error('refund failed', err));
}

async function takeQuota() {
  const day = new Date().toISOString().slice(0, 10);
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { pk: { S: `quota#${day}` }, createdAt: { S: day } },
        UpdateExpression: 'ADD n :one',
        ConditionExpression: 'attribute_not_exists(n) OR n < :limit',
        ExpressionAttributeValues: { ':one': { N: '1' }, ':limit': { N: String(DAILY_LIMIT) } },
      }),
    );
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

// ---------------------------------------------------------------- 路由

const PK_RE = /^[A-Z0-9-]{2,12}\|[a-z]+:[a-z0-9-]+$/;

async function listMeasurements(pk) {
  if (!PK_RE.test(pk || '')) return json(400, { error: 'bad pk' });
  const r = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': { S: pk } },
      ScanIndexForward: false,
      Limit: 10,
    }),
  );
  const items = (r.Items || []).map((it) => ({
    createdAt: it.createdAt.S,
    msmId: Number(it.msmId.N),
    target: it.target.S,
    protocol: it.protocol.S,
    kind: it.kind.S,
    probes: JSON.parse(it.probes.S),
    origin: JSON.parse(it.origin.S),
  }));
  return json(200, { items });
}

async function measure(event) {
  if (!isOwner(viewerIp(event.headers), OWNER_IPS)) return json(403, { error: 'only the site owner can start measurements' });
  if (!KEY) return json(503, { error: 'RIPE Atlas key not configured' });

  let body;
  try {
    body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '{}');
  } catch {
    return json(400, { error: 'bad json' });
  }
  const { lat, lng, country, cell, region: regionId } = body;
  if (![lat, lng].every((x) => typeof x === 'number' && Number.isFinite(x)) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return json(400, { error: 'bad coordinates' });
  if (!/^[A-Z]{2}$/.test(country || '')) return json(400, { error: 'bad country' });
  const pk = `${cell}|${regionId}`;
  if (!PK_RE.test(pk)) return json(400, { error: 'bad cell or region' });

  const { regions, targets } = await loadSiteData();
  const region = regions.get(regionId);
  if (!region) return json(404, { error: 'unknown region' });
  const target = targetFor(region, targets);
  if (!target) return json(422, { error: 'this region has no public test address' });

  const probes = await pickProbes(lat, lng, country);
  if (!probes.length) return json(422, { error: `no connected RIPE Atlas probe in ${country}` });
  if (!(await takeQuota())) return json(429, { error: `daily limit of ${DAILY_LIMIT} measurements reached` });

  const definition = {
    type: 'traceroute',
    af: 4,
    target: target.host,
    protocol: target.protocol,
    ...(target.protocol === 'TCP' ? { port: 443 } : {}),
    // RIPE Atlas 的描述只允许有限的字符（不能有 ":"、">" 等）。
    description: `nsite ${cell} to ${regionId}`.replace(/[^A-Za-z0-9 ._-]/g, ' '),
  };
  let created;
  try {
    created = await atlas('/measurements/', {
      method: 'POST',
      body: JSON.stringify({
        definitions: [definition],
        probes: [{ type: 'probes', value: probes.map((p) => p.id).join(','), requested: probes.length }],
        is_oneoff: true,
      }),
    });
  } catch (err) {
    await refundQuota();
    throw err;
  }
  const msmId = created.measurements[0];
  const createdAt = new Date().toISOString();
  const origin = { lat, lng, country, cell };
  await ddb.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: {
        pk: { S: pk },
        createdAt: { S: createdAt },
        msmId: { N: String(msmId) },
        target: { S: target.host },
        protocol: { S: target.protocol },
        kind: { S: target.kind },
        probes: { S: JSON.stringify(probes) },
        origin: { S: JSON.stringify(origin) },
      },
    }),
  );
  return json(201, { createdAt, msmId, target: target.host, protocol: target.protocol, kind: target.kind, probes, origin });
}

export async function handler(event) {
  const method = event.requestContext?.http?.method;
  const path = event.rawPath;
  try {
    if (method === 'GET' && path === '/api/whoami') {
      const ip = viewerIp(event.headers);
      return json(200, { owner: isOwner(ip, OWNER_IPS), ip, configured: Boolean(KEY) });
    }
    if (method === 'GET' && path === '/api/measurements') return await listMeasurements(event.queryStringParameters?.pk);
    if (method === 'POST' && path === '/api/measure') return await measure(event);
    return json(404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    return json(err.status && err.status < 500 ? 502 : 500, { error: err.message || 'internal error' });
  }
}
