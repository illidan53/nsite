import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'zh' | 'en';

const zh = {
  'app.title': '云数据中心网络地球',
  'app.loading': '加载海缆、数据中心与地图数据…',
  'app.loadError': '数据加载失败：{msg}',
  'hud.hintIdle': '点击地球上任意位置开始',
  'hud.hintActive': '在右侧选择数据中心查看路径 · Esc 返回',
  'hud.cables': '海缆',
  'hud.planned': '规划中海缆',
  'hud.hide': '点击隐藏',
  'hud.show': '点击显示',
  'hud.theme': '视觉',
  'hud.language': '语言',
  'hud.you': '按 IP 推断你在 {place}',
  'hud.useHere': '从这里开始',
  'theme.midnight': '午夜蓝',
  'theme.night': '城市夜光',
  'theme.marble': '蓝色弹珠',
  'theme.dots': '点阵',
  'theme.light': '浅色纸面',
  'footer.cables': '海缆',
  'footer.borders': '边界',
  'footer.measure': '测量',
  'footer.regions': '区域',
  'place.unknown': '未知地区',
  'place.ocean': '海上',
  'place.close': '关闭',
  'panel.back': '← 返回',
  'panel.nearby': '附近的云数据中心',
  'panel.nearbySort': '按估算 RTT 排序',
  'panel.any': '选择任意数据中心',
  'panel.anySearch': '搜索厂商、区域代码或城市',
  'panel.anyAll': '全部',
  'panel.oceanNote': '起点在海上，延迟按直线距离 × 1.5 粗估。',
  'panel.oceanRoute': '起点在海上，无法估算物理路径。请点击陆地。',
  'tab.estimate': '物理路径估算',
  'tab.mine': '站长实测',
  'tab.atlas': '公开锚点数据',
  'list.empty': '没有符合条件的数据中心。',
  'list.more': '加载更多（已显示 {shown} / {total}）',
  'badge.live': '同网实测',
  'badge.proxy': '同城实测',
  'badge.liveTitle': '有托管在该云网络内的 RIPE Atlas 锚点',
  'badge.proxyTitle': '有同城 RIPE Atlas 锚点可作参考',
  'est.unreachable': '在当前数据里找不到连到这个数据中心的物理路径（可能是孤立海岛或数据缺失）。',
  'est.rtt': '估算 RTT',
  'est.floor': '直线理论下限',
  'est.path': '光纤路径',
  'est.cables': '经过海缆',
  'est.cablesValue': '{n} 条',
  'est.kind.access': '接入网',
  'est.kind.land': '陆地光缆（估）',
  'est.kind.sub': '海缆',
  'est.cumulative': '累计 {ms}',
  'est.access': '家宽/移动网络最后一公里，按 {ms} ms 往返计（假设值）',
  'est.via': '经 {n} 个节点',
  'est.collapse': '收起',
  'est.rfs': '{year} 年投产',
  'est.owners': '运营方：{owners}',
  'est.origin': '起点',
  'est.method': '估算方法与局限',
  'est.m1': '光在光纤中约 {speed} km/ms（折射率 1.468），RTT = 2 × 路径长度 ÷ 光速。',
  'est.m2': '海缆走向来自 TeleGeography，按官方公布长度对绘制路径做比例校正。',
  'est.m3': '陆地段没有公开的全球光缆走向数据，用沿陆地的大圆距离 × {k} 近似，经过 Natural Earth 城市与登陆站。',
  'est.m4': '这是“物理上最短可行路径”，实际路由取决于运营商互联、BGP 策略和国际出口，往往更绕。真实路径请看「RIPE Atlas 实测」。',
  'atlas.none': '这个区域附近没有 RIPE Atlas 锚点，拿不到公开的持续测量数据。',
  'atlas.noneHint':
    '可以用自己的 RIPE Atlas 积分，从离起点最近的探针向该区域的公网端点发起一次性 traceroute（仓库 docs/atlas-targets.json 里有实测可用的目标）。',
  'atlas.same': '同网',
  'atlas.proxy': '同城',
  'atlas.sameNote': '目标锚点托管在 {provider} 网络内（AS{asn}，{company}），路径直达云厂商网络。',
  'atlas.proxyNote':
    '目标锚点位于同城 {km} km 处的 {company}（AS{asn}），不在 {provider} 网络内：到达该城市的线路是真实的，最后进入云厂商网络的那段会有差别。',
  'atlas.searching': '查找 {radius} km 内的 RIPE Atlas 探针…',
  'atlas.reading': '读取 {n} 个探针到 {target} 的最新 traceroute…',
  'atlas.error': '请求 RIPE Atlas 失败：{msg}',
  'atlas.noProbes': '4000 km 内没有参与该锚点测量的探针。',
  'atlas.ping': '实测 RTT（ping 最小值）',
  'atlas.lastHop': 'traceroute 末跳',
  'atlas.probe': '起点探针',
  'atlas.time': '测量时间',
  'atlas.far': '附近没有参与该锚点测量的探针，最近的起点在 {km} km 外，结果只能作为区域参考。',
  'atlas.unreached': '这次 traceroute 没有收到目标应答，最后几跳可能缺失。',
  'atlas.colHop': '#',
  'atlas.colRouter': '路由器 / 网络',
  'atlas.colLoc': '位置',
  'atlas.private': '内网',
  'atlas.badLoc': '与 RTT 矛盾：光在这么短的时间内到不了这里，IP 定位多半有误',
  'atlas.footnote':
    '跳点位置来自 RIPE IPmap，归属网络来自 RIPEstat。Δ 为与上一跳最小 RTT 之差，路由器对 ICMP 的处理优先级较低，个别跳会出现负值或尖峰。划线的位置不满足光速约束（RTT 太小、距离太远），已从地球上的路径中排除。',
  'atlas.source': '数据：RIPE Atlas 公开的 anchoring 测量（每 15 分钟一次），不使用个人账号、不消耗积分。',
  'mine.noticeTitle': '说明：以下测量由站长用个人 RIPE Atlas 账号发起',
  'mine.notice':
    '每次测量消耗站长个人的 RIPE Atlas 积分，只有站长本人的网络地址可以触发。起点探针取自你在地球上点击的国家（离点击处最近的在线探针），目标是该数据中心的公开测试地址。测量与 RIPE NCC 及各云厂商均无关联，结果公开在 RIPE Atlas 上，仅供参考。',
  'mine.target': '目标：',
  'mine.kind.public': '公开测试地址',
  'mine.kind.anchorSame': '该厂商网络内的 RIPE Atlas 锚点',
  'mine.kind.anchorProxy': '同城 RIPE Atlas 锚点代测（距该区域 {km} km，不在该厂商网络内）',
  'mine.proto.icmp': 'traceroute（ICMP）',
  'mine.proto.tcp': 'traceroute（TCP 443）',
  'mine.noTarget': '这个区域没有可测量的目标（没有公开测试地址，也没有同城锚点）。',
  'mine.noCell': '起点不在任何国家境内，无法选择探针。请点击陆地。',
  'mine.run': '发起测量（约 {credits} 积分）',
  'mine.rerun': '重新测量（约 {credits} 积分）',
  'mine.running': '正在创建测量…',
  'mine.ownerHint': '起点地区 {cell}，每次 3 个探针',
  'mine.error': '发起测量失败：{msg}',
  'mine.apiDown': '测量服务暂不可用。',
  'mine.none': '从 {cell} 到该数据中心还没有站长实测。',
  'mine.ownerOnly': '只有站长可以发起测量。',
  'mine.measuredAt': '测量于 {ago}',
  'mine.link': 'RIPE Atlas 测量 #{id}',
  'mine.waiting': '测量进行中：已收到 {got}/{n} 个探针的结果，通常 1–5 分钟完成。',
  'mine.noResult': '这个探针没有返回结果。',
  'mine.history': '更早的测量',
  'ago.now': '刚刚',
  'ago.min': '{n} 分钟前',
  'ago.hour': '{n} 小时前',
  'ago.day': '{n} 天前',
  'tip.planned': '规划中',
  'tip.rfs': '投产 {year}',
  'marker.probe': '探针 #{id}',
  'marker.hop': '第 {hop} 跳 {ip} · {city}',
  'marker.you': '你大概在这里（按 IP 推断）',
  'info.province': '省 / 州',
  'info.country': '国家 / 地区',
  'info.timezone': '时区',
  'info.localTime': '当地 {time}',
  'info.probes': 'RIPE Atlas 探针',
  'info.probesValue': '省内 {province} · 全国 {country}（在线）',
  'info.probesCountry': '全国 {country}（在线）',
  'info.population': '人口',
  'info.popProvince': '本省 {n}（{year}）',
  'info.popCountry': '全国 {n}（{year}）',
  'info.climate': '气候',
  'info.sources': '人口：Wikidata、Natural Earth；气候：柯本分类，Beck et al. 2023（1991–2020）；时区：tz-lookup；探针：RIPE Atlas。',
  'ips.link': '公开测试 IP · {n}',
  'ips.title': '公开测试 IP',
  'ips.stats': '{n} 个区域 · ICMP {icmp} · TCP 443 {tcp}',
  'ips.intro': '各云厂商区域里可以直接 ping 或 TCP 连接的公开地址，可以用 RIPE Atlas 等工具从任意位置测到该区域的延迟和路由。',
  'ips.ipNote': 'IP 可能随时变化，测量时建议填域名。',
  'ips.gcp': 'Google Cloud 没有收录：它的区域服务都在 Google 前端的 anycast 地址后面，ping/traceroute 只会到最近的边缘节点。',
  'ips.search': '搜索厂商、区域、城市、域名或 IP',
  'ips.back': '← 全部 IP',
  'ips.ip': 'IP 地址',
  'ips.host': '域名',
  'ips.source': '数据源',
  'ips.docs': '官方文档',
  'ips.method': '测量方式',
  'ips.method.icmp': 'ping / traceroute（ICMP）',
  'ips.method.tcp443': 'TCP traceroute，端口 443（不响应 ping）',
  'ips.check': '初次检查',
  'ips.checkFrom': '{date}，从美国新泽西的一台机器测得（不是 RIPE Atlas）',
  'ips.floor': '光纤直线下限 {ms}',
  'ips.copy': '复制',
  'ips.copied': '已复制',
  'ips.badge.icmp': 'ICMP',
  'ips.badge.tcp443': 'TCP 443',
};

export type MessageKey = keyof typeof zh;

const en: Record<MessageKey, string> = {
  'app.title': 'Cloud data-center network globe',
  'app.loading': 'Loading cables, data centers and map data…',
  'app.loadError': 'Failed to load data: {msg}',
  'hud.hintIdle': 'Click anywhere on the globe to start',
  'hud.hintActive': 'Pick a data center on the right to see the route · Esc to go back',
  'hud.cables': 'Cables',
  'hud.planned': 'Planned cables',
  'hud.hide': 'Click to hide',
  'hud.show': 'Click to show',
  'hud.theme': 'Look',
  'hud.language': 'Language',
  'hud.you': 'Your IP suggests {place}',
  'hud.useHere': 'Start here',
  'theme.midnight': 'Midnight',
  'theme.night': 'City lights',
  'theme.marble': 'Blue marble',
  'theme.dots': 'Dot matrix',
  'theme.light': 'Paper',
  'footer.cables': 'Cables',
  'footer.borders': 'Borders',
  'footer.measure': 'Measurements',
  'footer.regions': 'Regions',
  'place.unknown': 'Unknown area',
  'place.ocean': 'At sea',
  'place.close': 'Close',
  'panel.back': '← Back',
  'panel.nearby': 'Nearby cloud data centers',
  'panel.nearbySort': 'Sorted by estimated RTT',
  'panel.any': 'Pick any data center',
  'panel.anySearch': 'Search provider, region code or city',
  'panel.anyAll': 'All',
  'panel.oceanNote': 'This point is at sea; latency is a rough great-circle × 1.5 estimate.',
  'panel.oceanRoute': 'This point is at sea, so there is no physical route to estimate. Click on land.',
  'tab.estimate': 'Physical route',
  'tab.mine': 'Owner-run test',
  'tab.atlas': 'Public anchor data',
  'list.empty': 'No data centers match.',
  'list.more': 'Load more ({shown} of {total} shown)',
  'badge.live': 'In-network',
  'badge.proxy': 'Same city',
  'badge.liveTitle': 'A RIPE Atlas anchor is hosted inside this cloud network',
  'badge.proxyTitle': 'A RIPE Atlas anchor in the same city can serve as a reference',
  'est.unreachable': 'No physical route to this data center in the current data (it may be an isolated island or missing data).',
  'est.rtt': 'Estimated RTT',
  'est.floor': 'Straight-line floor',
  'est.path': 'Fiber path',
  'est.cables': 'Submarine cables',
  'est.cablesValue': '{n}',
  'est.kind.access': 'ACCESS',
  'est.kind.land': 'TERRESTRIAL (EST.)',
  'est.kind.sub': 'SUBMARINE',
  'est.cumulative': 'total {ms}',
  'est.access': 'Last mile (home or mobile), assumed {ms} ms round trip',
  'est.via': 'via {n} nodes',
  'est.collapse': 'Collapse',
  'est.rfs': 'in service {year}',
  'est.owners': 'Owners: {owners}',
  'est.origin': 'Origin',
  'est.method': 'Method and limits',
  'est.m1': 'Light travels about {speed} km/ms in fiber (refractive index 1.468); RTT = 2 × path length ÷ speed.',
  'est.m2': 'Cable routes come from TeleGeography, scaled so each cable matches its published length.',
  'est.m3': 'No open global data exists for land fiber, so land legs use the over-land great-circle distance × {k}, via Natural Earth cities and landing stations.',
  'est.m4': 'This is the shortest physically possible path. Real routes depend on peering, BGP policy and international gateways and are usually longer. See “RIPE Atlas live” for measured paths.',
  'atlas.none': 'No RIPE Atlas anchor is near this region, so there is no public continuous measurement.',
  'atlas.noneHint':
    'With your own RIPE Atlas credits you can run a one-off traceroute from the probe nearest the origin to a public endpoint in this region (verified targets are in docs/atlas-targets.json in the repo).',
  'atlas.same': 'In-network',
  'atlas.proxy': 'Same city',
  'atlas.sameNote': 'The target anchor is hosted inside {provider} (AS{asn}, {company}), so the path reaches the cloud network itself.',
  'atlas.proxyNote':
    'The target anchor is at {company} (AS{asn}), {km} km away in the same city and outside {provider}: the path into the city is real, but the final hop into the cloud network will differ.',
  'atlas.searching': 'Looking for RIPE Atlas probes within {radius} km…',
  'atlas.reading': 'Reading the latest traceroutes from {n} probes to {target}…',
  'atlas.error': 'RIPE Atlas request failed: {msg}',
  'atlas.noProbes': 'No probe within 4000 km takes part in this anchor’s measurements.',
  'atlas.ping': 'Measured RTT (min ping)',
  'atlas.lastHop': 'Traceroute last hop',
  'atlas.probe': 'Source probe',
  'atlas.time': 'Measured',
  'atlas.far': 'No participating probe nearby; the closest source is {km} km away, so treat the result as regional.',
  'atlas.unreached': 'The target did not answer this traceroute; the last hops may be missing.',
  'atlas.colHop': '#',
  'atlas.colRouter': 'Router / network',
  'atlas.colLoc': 'Location',
  'atlas.private': 'private',
  'atlas.badLoc': 'Contradicts the RTT: light cannot get this far that quickly, so the IP location is probably wrong',
  'atlas.footnote':
    'Hop locations from RIPE IPmap, networks from RIPEstat. Δ is the change in minimum RTT from the previous hop; routers answer ICMP at low priority, so some hops show negative values or spikes. Struck-out locations fail the speed-of-light check and are left off the globe.',
  'atlas.source': 'Data: RIPE Atlas public anchoring measurements (every 15 minutes); no personal account or credits involved.',
  'mine.noticeTitle': 'Note: these measurements are run from the site owner’s personal RIPE Atlas account',
  'mine.notice':
    'Each run spends the owner’s own RIPE Atlas credits and can only be started from the owner’s network address. Source probes are the connected probes nearest to where you clicked, in that country; the target is the data center’s public test address. Not affiliated with RIPE NCC or any cloud provider; results are public on RIPE Atlas and for reference only.',
  'mine.target': 'Target:',
  'mine.kind.public': 'public test address',
  'mine.kind.anchorSame': 'RIPE Atlas anchor inside this provider',
  'mine.kind.anchorProxy': 'same-city RIPE Atlas anchor as a stand-in ({km} km away, outside this provider)',
  'mine.proto.icmp': 'traceroute (ICMP)',
  'mine.proto.tcp': 'traceroute (TCP 443)',
  'mine.noTarget': 'Nothing to measure in this region (no public test address and no same-city anchor).',
  'mine.noCell': 'This point is not inside any country, so no probes can be chosen. Click on land.',
  'mine.run': 'Run measurement (~{credits} credits)',
  'mine.rerun': 'Measure again (~{credits} credits)',
  'mine.running': 'Creating measurement…',
  'mine.ownerHint': 'Origin area {cell}, 3 probes per run',
  'mine.error': 'Could not start the measurement: {msg}',
  'mine.apiDown': 'The measurement service is unavailable.',
  'mine.none': 'No owner-run measurement from {cell} to this data center yet.',
  'mine.ownerOnly': 'Only the site owner can start one.',
  'mine.measuredAt': 'Measured {ago}',
  'mine.link': 'RIPE Atlas measurement #{id}',
  'mine.waiting': 'Measuring: {got}/{n} probes have reported; this usually takes 1–5 minutes.',
  'mine.noResult': 'This probe returned no result.',
  'mine.history': 'Earlier measurements',
  'ago.now': 'just now',
  'ago.min': '{n} min ago',
  'ago.hour': '{n} h ago',
  'ago.day': '{n} d ago',
  'tip.planned': 'planned',
  'tip.rfs': 'in service {year}',
  'marker.probe': 'Probe #{id}',
  'marker.hop': 'Hop {hop} {ip} · {city}',
  'marker.you': 'Roughly where you are (from your IP)',
  'info.province': 'Province / state',
  'info.country': 'Country / area',
  'info.timezone': 'Time zone',
  'info.localTime': 'local {time}',
  'info.probes': 'RIPE Atlas probes',
  'info.probesValue': '{province} in province · {country} in country (online)',
  'info.probesCountry': '{country} in country (online)',
  'info.population': 'Population',
  'info.popProvince': 'province {n} ({year})',
  'info.popCountry': 'country {n} ({year})',
  'info.climate': 'Climate',
  'info.sources': 'Population: Wikidata, Natural Earth; climate: Köppen classes, Beck et al. 2023 (1991–2020); time zone: tz-lookup; probes: RIPE Atlas.',
  'ips.link': 'Public test IPs · {n}',
  'ips.title': 'Public test IPs',
  'ips.stats': '{n} regions · ICMP {icmp} · TCP 443 {tcp}',
  'ips.intro': 'Public addresses inside each cloud region that answer ping or TCP. Use them with RIPE Atlas or similar tools to measure latency and routes to that region from anywhere.',
  'ips.ipNote': 'IPs can change at any time; use the hostname when measuring.',
  'ips.gcp': 'Google Cloud is not listed: its regional services sit behind Google’s anycast front end, so ping and traceroute only reach the nearest edge.',
  'ips.search': 'Search provider, region, city, hostname or IP',
  'ips.back': '← All IPs',
  'ips.ip': 'IP address',
  'ips.host': 'Hostname',
  'ips.source': 'Source',
  'ips.docs': 'Documentation',
  'ips.method': 'How to measure',
  'ips.method.icmp': 'ping / traceroute (ICMP)',
  'ips.method.tcp443': 'TCP traceroute to port 443 (no ping reply)',
  'ips.check': 'Initial check',
  'ips.checkFrom': 'Measured {date} from a machine in New Jersey, US (not RIPE Atlas)',
  'ips.floor': 'straight-line floor {ms}',
  'ips.copy': 'Copy',
  'ips.copied': 'Copied',
  'ips.badge.icmp': 'ICMP',
  'ips.badge.tcp443': 'TCP 443',
};

const MESSAGES: Record<Lang, Record<MessageKey, string>> = { zh, en };
const STORAGE_KEY = 'nsite-lang';

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translate;
  /** 按当前语言在中文名与英文名之间选择；缺中文名时退回英文。 */
  pick: (en: string, zh?: string | null) => string;
}

const I18nContext = createContext<I18n | null>(null);

function initialLang(): Lang {
  const q = new URLSearchParams(window.location.search).get('lang');
  if (q === 'zh' || q === 'en') return q;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    // 存储被禁用时按浏览器语言
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function format(template: string, vars?: Record<string, string | number>) {
  return vars ? template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : template;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 忽略
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = `Net Globe · ${MESSAGES[lang]['app.title']}`;
  }, [lang]);

  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => format(MESSAGES[lang][key], vars),
      pick: (enName, zhName) => (lang === 'zh' && zhName ? zhName : enName),
    }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
