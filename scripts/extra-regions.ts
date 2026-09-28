// 腾讯云区域（上游 cloud-regions 数据集未收录）。
// 区域列表来自官方文档（2026-09 核对）：https://www.tencentcloud.com/document/product/213/6091
// 坐标取所在城市中心，只精确到城市级别。金融云、自动驾驶云等专用区域未收录。

import type { ProviderId } from '../src/lib/types.ts';

interface ExtraRegion {
  provider: ProviderId;
  code: string;
  name: string;
  nameZh: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
}

type Row = [code: string, nameZh: string, name: string, city: string, country: string, cc: string, lat: number, lng: number];
const row = (provider: ProviderId) => (...[code, nameZh, name, city, country, cc, lat, lng]: Row): ExtraRegion =>
  ({ provider, code, name, nameZh, city, country, countryCode: cc, lat, lng });
const T = row('tencent');

export const EXTRA_REGIONS: ExtraRegion[] = [
  T('ap-beijing', '华北地区（北京）', 'North China (Beijing)', 'Beijing', 'China', 'CN', 39.904, 116.407),
  T('ap-shanghai', '华东地区（上海）', 'East China (Shanghai)', 'Shanghai', 'China', 'CN', 31.230, 121.474),
  T('ap-nanjing', '华东地区（南京）', 'East China (Nanjing)', 'Nanjing', 'China', 'CN', 32.060, 118.797),
  T('ap-guangzhou', '华南地区（广州）', 'South China (Guangzhou)', 'Guangzhou', 'China', 'CN', 23.129, 113.264),
  T('ap-chengdu', '西南地区（成都）', 'Southwest China (Chengdu)', 'Chengdu', 'China', 'CN', 30.573, 104.066),
  T('ap-chongqing', '西南地区（重庆）', 'Southwest China (Chongqing)', 'Chongqing', 'China', 'CN', 29.563, 106.551),
  T('ap-zhongwei', '西北地区（中卫）', 'Northwest China (Zhongwei)', 'Zhongwei', 'China', 'CN', 37.500, 105.190),
  T('ap-hongkong', '港澳台地区（中国香港）', 'Hong Kong', 'Hong Kong', 'Hong Kong', 'HK', 22.320, 114.170),
  T('ap-singapore', '亚太东南（新加坡）', 'Southeast Asia (Singapore)', 'Singapore', 'Singapore', 'SG', 1.352, 103.820),
  T('ap-johorbahru', '亚太东南（柔佛巴鲁）', 'Southeast Asia (Johor Bahru)', 'Johor Bahru', 'Malaysia', 'MY', 1.492, 103.741),
  T('ap-jakarta', '亚太东南（雅加达）', 'Southeast Asia (Jakarta)', 'Jakarta', 'Indonesia', 'ID', -6.208, 106.846),
  T('ap-bangkok', '亚太东南（曼谷）', 'Southeast Asia (Bangkok)', 'Bangkok', 'Thailand', 'TH', 13.756, 100.502),
  T('ap-seoul', '亚太东北（首尔）', 'Northeast Asia (Seoul)', 'Seoul', 'South Korea', 'KR', 37.566, 126.978),
  T('ap-tokyo', '亚太东北（东京）', 'Northeast Asia (Tokyo)', 'Tokyo', 'Japan', 'JP', 35.676, 139.650),
  T('ap-osaka', '亚太东北（大阪）', 'Northeast Asia (Osaka)', 'Osaka', 'Japan', 'JP', 34.694, 135.502),
  T('me-saudi-arabia', '中东（沙特）', 'Middle East (Saudi Arabia)', 'Riyadh', 'Saudi Arabia', 'SA', 24.713, 46.675),
  T('sa-saopaulo', '南美东部（圣保罗）', 'South America (São Paulo)', 'São Paulo', 'Brazil', 'BR', -23.551, -46.633),
  T('na-queretaro', '北美（克雷塔罗）', 'North America (Querétaro)', 'Querétaro', 'Mexico', 'MX', 20.588, -100.390),
  T('na-siliconvalley', '美国西部（硅谷）', 'US West (Silicon Valley)', 'Santa Clara', 'United States', 'US', 37.354, -121.955),
  T('na-ashburn', '美国东部（弗吉尼亚）', 'US East (Virginia)', 'Ashburn', 'United States', 'US', 39.044, -77.487),
  T('eu-frankfurt', '欧洲地区（法兰克福）', 'Europe (Frankfurt)', 'Frankfurt', 'Germany', 'DE', 50.110, 8.682),
];
