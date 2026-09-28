# Net Globe · 云数据中心网络地球

React + three.js（react-globe.gl）做的交互式地球。点击任意位置，右侧 off-canvas 面板会显示：

1. **位置**：国家 + 省/州，用 Natural Earth 边界离线反查，不调用第三方接口；
2. **附近的云数据中心**：共 11 家厂商、307 个区域（AWS / Azure / GCP / 阿里云 / 腾讯云 / Oracle / DigitalOcean / Vultr / Linode / OVH / Hetzner），按估算 RTT 排序；
3. **到每个数据中心的延迟**，点开后可以查看网络路径，有两种视图：
   - **物理路径估算**：在“海缆真实走向 + 陆地骨干近似”组成的图上求最短路径，逐段给出距离、单段 RTT、累计 RTT、经过的海缆（名称、投产年份、运营方），路线同步画在地球上；
   - **RIPE Atlas 实测**：取离点击位置最近的 RIPE Atlas 探针到该机房（或同城锚点）的最新 traceroute，逐跳给出 IP、所属 AS、城市位置、RTT 和相邻跳之间的增量，并把路径画在地球上。

支持 URL 深链接：`/?lat=31.23&lng=121.47&dc=aws:ap-northeast-1&tab=atlas`。

## 快速开始

```bash
npm install
npm run data     # 下载并预处理数据到 public/data/（首次约 1 分钟，原始文件缓存在 .data-cache/）
npm run dev      # http://127.0.0.1:5173
```

其他命令：`npm test`（vitest）、`npm run lint`（tsc）、`npm run build`。

`public/data/` 和 `.data-cache/` 不入库，里面有 TeleGeography 的 CC BY-NC-SA 数据。部署前需要在构建环境里执行一次 `npm run data`。

## 部署

线上地址：https://global-network.nphunter.gg

- **基础设施**：`infra/`（Pulumi TypeScript，项目 `nsite-infra`，stack `prod`），AWS 账号与 nphunter.gg 相同（`nphunter-sso` profile，us-east-1）。
  - 私有 S3 桶 `nsite-global-network`，经 CloudFront OAC 访问；
  - ACM 证书用 DNS 验证，Route 53 的 `nphunter.gg` 托管区里有 A/AAAA 别名记录；
  - GitHub OIDC 部署角色 `nsite-github-deploy`，只允许 `illidan53/nsite` 的 `main` 分支使用。

  ```bash
  cd infra && npm ci && AWS_PROFILE=nphunter-sso pulumi up -s prod
  ```

- **发布**：push 到 `main` 时，`.github/workflows/deploy.yml` 会依次执行：
  1. lint 和单元测试；
  2. `npm run data`，原始下载按 ISO 周缓存；
  3. `npm run build`；
  4. 上传到 S3：带哈希的资源长缓存，`index.html` 每次重新验证；
  5. 让 CloudFront 失效，然后对线上地址做冒烟测试。

  每周一还会定时重新发布一次，用来刷新海缆、云区域和锚点数据。

## 目录

```
scripts/build-data.ts     数据管线：下载 → 清洗 → 栅格化陆地 → 生成陆地骨干图 → 关联 RIPE Atlas 锚点
scripts/extra-regions.ts  阿里云 / 腾讯云区域（上游数据集未收录）
src/lib/geo.ts            大圆距离、插值、0.1° 陆地位图（浏览器和 Node 共用）
src/lib/routing.ts        路径图构建、Dijkstra、分段与 RTT 估算
src/lib/atlas.ts          RIPE Atlas / IPmap / RIPEstat 客户端
src/lib/places.ts         国家、省级行政区反查
src/components/           GlobeView、Panel、RegionList、RouteEstimate、RouteAtlas
```

## 用到的数据

| 数据 | 来源 | 许可 | 用途 |
|---|---|---|---|
| 海缆走向、登陆站、长度/运营方/投产年份 | [TeleGeography Submarine Cable Map](https://www.submarinecablemap.com/) 公开 JSON（`/api/v3/cable/cable-geo.json` 等） | **CC BY-NC-SA 3.0（禁止商用）** | 地球海缆图层、路径图的海底部分 |
| 国家 / 省级边界、陆地、城市 | [Natural Earth](https://www.naturalearthdata.com/) | 公有领域 | 反查位置；陆地位图；陆地骨干的枢纽城市 |
| 云区域坐标 | [jasonwilbur/mcp-server-cloud-regions](https://github.com/jasonwilbur/mcp-server-cloud-regions) + 手工补充的阿里云、腾讯云 | MIT | 数据中心点位 |
| 实测 traceroute / ping | [RIPE Atlas](https://atlas.ripe.net/) anchoring 测量 | RIPE Atlas 服务条款（数据公开） | 实测视图 |
| 路由器地理定位 | [RIPE IPmap](https://ipmap.ripe.net/) | 同上 | 实测路径的逐跳位置 |
| IP → ASN / 持有者 | [RIPEstat](https://stat.ripe.net/) | 同上 | 逐跳所属网络 |

## 路由 / 延迟数据调研

需求第 3 点想要“到数据中心的网络路线 + 每段延迟”。公开数据按可用程度大致分成三类。

### 1. 真实路由（逐跳）：首选 RIPE Atlas

- **Anchoring 测量（本项目已接入，无需 key）**：每个 RIPE Atlas 锚点每 15 分钟会被约 1,000 个其他锚点加约 400 个普通探针做一次 traceroute 和 ping，结果全部公开，浏览器可以直接跨域调用。
  - 这些锚点里有不少就托管在云厂商机房内：Vultr 18 个、DigitalOcean 8 个、OVH 7 个、Linode 3 个、Hetzner 3 个、AWS 法兰克福 1 个。这类区域在界面上标为“同网实测”。
  - 其余区域用 60 km 内的其他锚点作“同城参考”。307 个区域里有 233 个能拿到实测数据。
- **AWS / Azure / GCP 本身几乎没有锚点。** 针对它们的公开测量大多是 CDN 的 anycast 地址（如 `d1.awsstatic.com`），不对应具体区域。要测某个具体区域，需要自己发起测量。
  - 你在运行 RIPE Atlas 探针（Mac 上的 #1017915 和 Zenlayer 利马的 #1017942），会持续获得积分，可以用来发起一次性 traceroute。
  - 后续可以加一个小后端：由后端持有 API key，从离点击位置最近的探针向区域公网端点发起测量，例如 `dynamodb.<region>.amazonaws.com`，或者自己在各区域部署的 VM。
- **RIPE IPmap**：专门做路由器（基础设施 IP）地理定位，比普通 IP 库更准，但仍有错误。本项目加了**光速约束校验**：定位出来的距离如果超过 RTT/2 × 204 km/ms，就判为不可信，不画到地球上。
- **RIPEstat**：查 IP 所属 ASN 和持有者、BGP 前缀，也能查 AS 路径和可见性。

### 2. 其他测量 / 拓扑数据集（适合离线分析或二期）

- **M-Lab**：NDT 测速附带 scamper traceroute，全部公开在 BigQuery。样本量大，但起点偏向测速用户。
- **CAIDA Ark / ITDK**：路由器级拓扑，附带地理定位与 AS 归属。部分数据需要申请访问。
- **PeeringDB**：IXP、数据中心设施（含坐标）以及各网络在哪些设施互联。可以把陆地骨干的节点从“大城市”换成“真实的互联设施”。
- **RouteViews / RIPE RIS**：BGP 表和更新，用来看 AS 级路径。
- **云厂商跨区域延迟**：AWS Network Manager Infrastructure Performance（需要账号）、Azure 文档里的 round-trip latency 统计表、gcping、cloudping.co。这些只覆盖区域到区域，不覆盖用户到区域。

### 3. 物理线路（光缆走向）

- **海缆**：TeleGeography 是事实标准（已接入）。注意许可**禁止商用**，商用需要联系 TeleGeography 授权，或换用 Infrapedia 等数据源。
- **陆地光缆**：没有全球性的开放数据。
  - ITU BBMaps 需要申请；Infrapedia 可以在线浏览，数据下载需要商务合作。
  - OpenFiberMap / AfTerFibre / OFDS 只覆盖部分国家（以非洲为主）；OSM 的 telecom 标签很稀疏。
  - 因此本项目的陆地段用“沿陆地的大圆距离 × 1.4”近似，经过城市节点和登陆站。

## 估算模型

- 光纤中光速 ≈ 204 km/ms（折射率 1.468），RTT = 2 × 路径长度 ÷ 光速，再加 4 ms 接入网（假设值）。
- 海缆按 TeleGeography 绘制的走向计算长度，再按官方公布长度 / 绘制长度做比例校正（限制在 1.0–1.5 之间）。每条海缆单独建图，不同海缆在海上不连通，只能在登陆站之间换乘。
- 陆地图在 `npm run data` 时预计算：节点是枢纽城市、机房和登陆站，每个节点连到最近的几个节点，每条边都用 0.1° 陆地位图校验确实走陆地，允许 15 km 以内的水面。
- 这是“物理上可行的最短路径”，实际延迟通常更高：BGP 策略、运营商互联位置、国际出口（例如中国大陆出境流量要经过少数几个国际出口局）都会让路径绕远。页面上两个视图可以直接对比，例如秘鲁库斯科 → AWS 圣保罗：估算 46 ms，同城锚点实测 94 ms。

## 已知限制 / 下一步

- 中国大陆的 RIPE Atlas 探针很少，点击大陆城市时，实测起点经常在台湾、日本、韩国，面板会提示距离。
- 若面向中国大陆公开上线，地图需要符合相关规定（审图号），国界线建议改用合规底图。Natural Earth 提供按国家立场的边界版本，例如 `ne_10m_admin_0_countries_chn`。
- 二期可以做：
  - 后端代理 RIPE Atlas 一次性测量，覆盖 AWS、Azure、GCP 的具体区域；
  - 接入 PeeringDB 设施，改进陆地节点；
  - 缓存实测结果；
  - 增加 IPv6。
