// 阿里云、腾讯云区域（上游 cloud-regions 数据集未收录）。
// 区域列表来自官方文档（2026-09 核对）：
//   https://www.alibabacloud.com/help/en/ecs/user-guide/regions-and-zones
//   https://www.tencentcloud.com/document/product/213/6091
// 坐标取所在城市中心，只精确到城市级别。金融云、自动驾驶云等专用区域未收录。

import type { ProviderId } from '../src/lib/types.ts';

interface ExtraRegion {
  provider: ProviderId;
  code: string;
  name: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
}

const A = (code: string, name: string, city: string, country: string, cc: string, lat: number, lng: number): ExtraRegion =>
  ({ provider: 'alibaba', code, name, city, country, countryCode: cc, lat, lng });
const T = (code: string, name: string, city: string, country: string, cc: string, lat: number, lng: number): ExtraRegion =>
  ({ provider: 'tencent', code, name, city, country, countryCode: cc, lat, lng });

export const EXTRA_REGIONS: ExtraRegion[] = [
  A('cn-qingdao', '华北1（青岛）', 'Qingdao', 'China', 'CN', 36.067, 120.383),
  A('cn-beijing', '华北2（北京）', 'Beijing', 'China', 'CN', 39.904, 116.407),
  A('cn-zhangjiakou', '华北3（张家口）', 'Zhangjiakou', 'China', 'CN', 40.768, 114.886),
  A('cn-huhehaote', '华北5（呼和浩特）', 'Hohhot', 'China', 'CN', 40.842, 111.749),
  A('cn-wulanchabu', '华北6（乌兰察布）', 'Ulanqab', 'China', 'CN', 40.994, 113.133),
  A('cn-hangzhou', '华东1（杭州）', 'Hangzhou', 'China', 'CN', 30.274, 120.155),
  A('cn-shanghai', '华东2（上海）', 'Shanghai', 'China', 'CN', 31.230, 121.474),
  A('cn-shenzhen', '华南1（深圳）', 'Shenzhen', 'China', 'CN', 22.620, 114.030),
  A('cn-heyuan', '华南2（河源）', 'Heyuan', 'China', 'CN', 23.743, 114.701),
  A('cn-guangzhou', '华南3（广州）', 'Guangzhou', 'China', 'CN', 23.129, 113.264),
  A('cn-chengdu', '西南1（成都）', 'Chengdu', 'China', 'CN', 30.573, 104.066),
  A('cn-zhongwei', '中国（中卫）', 'Zhongwei', 'China', 'CN', 37.500, 105.190),
  A('cn-hongkong', '中国香港', 'Hong Kong', 'Hong Kong', 'HK', 22.320, 114.170),
  A('ap-southeast-1', '新加坡', 'Singapore', 'Singapore', 'SG', 1.352, 103.820),
  A('ap-southeast-3', '马来西亚（吉隆坡）', 'Kuala Lumpur', 'Malaysia', 'MY', 3.139, 101.687),
  A('ap-southeast-5', '印度尼西亚（雅加达）', 'Jakarta', 'Indonesia', 'ID', -6.208, 106.846),
  A('ap-southeast-6', '菲律宾（马尼拉）', 'Manila', 'Philippines', 'PH', 14.599, 120.984),
  A('ap-southeast-7', '泰国（曼谷）', 'Bangkok', 'Thailand', 'TH', 13.756, 100.502),
  A('ap-southeast-8', '马来西亚（柔佛）', 'Johor Bahru', 'Malaysia', 'MY', 1.492, 103.741),
  A('ap-northeast-1', '日本（东京）', 'Tokyo', 'Japan', 'JP', 35.676, 139.650),
  A('ap-northeast-2', '韩国（首尔）', 'Seoul', 'South Korea', 'KR', 37.566, 126.978),
  A('us-west-1', '美国（硅谷）', 'San Jose', 'United States', 'US', 37.339, -121.895),
  A('us-east-1', '美国（弗吉尼亚）', 'Ashburn', 'United States', 'US', 39.044, -77.487),
  A('eu-central-1', '德国（法兰克福）', 'Frankfurt', 'Germany', 'DE', 50.110, 8.682),
  A('eu-west-1', '英国（伦敦）', 'London', 'United Kingdom', 'GB', 51.507, -0.128),
  A('eu-west-2', '法国（巴黎）', 'Paris', 'France', 'FR', 48.857, 2.352),
  A('me-east-1', '阿联酋（迪拜）', 'Dubai', 'United Arab Emirates', 'AE', 25.205, 55.271),
  A('me-central-1', '沙特（利雅得）', 'Riyadh', 'Saudi Arabia', 'SA', 24.713, 46.675),
  A('na-south-1', '墨西哥', 'Querétaro (approx.)', 'Mexico', 'MX', 20.588, -100.390),
  A('sa-east-1', '巴西（圣保罗）', 'São Paulo', 'Brazil', 'BR', -23.551, -46.633),

  T('ap-beijing', '华北地区（北京）', 'Beijing', 'China', 'CN', 39.904, 116.407),
  T('ap-shanghai', '华东地区（上海）', 'Shanghai', 'China', 'CN', 31.230, 121.474),
  T('ap-nanjing', '华东地区（南京）', 'Nanjing', 'China', 'CN', 32.060, 118.797),
  T('ap-guangzhou', '华南地区（广州）', 'Guangzhou', 'China', 'CN', 23.129, 113.264),
  T('ap-chengdu', '西南地区（成都）', 'Chengdu', 'China', 'CN', 30.573, 104.066),
  T('ap-chongqing', '西南地区（重庆）', 'Chongqing', 'China', 'CN', 29.563, 106.551),
  T('ap-zhongwei', '西北地区（中卫）', 'Zhongwei', 'China', 'CN', 37.500, 105.190),
  T('ap-hongkong', '港澳台地区（中国香港）', 'Hong Kong', 'Hong Kong', 'HK', 22.320, 114.170),
  T('ap-singapore', '亚太东南（新加坡）', 'Singapore', 'Singapore', 'SG', 1.352, 103.820),
  T('ap-johorbahru', '亚太东南（柔佛巴鲁）', 'Johor Bahru', 'Malaysia', 'MY', 1.492, 103.741),
  T('ap-jakarta', '亚太东南（雅加达）', 'Jakarta', 'Indonesia', 'ID', -6.208, 106.846),
  T('ap-bangkok', '亚太东南（曼谷）', 'Bangkok', 'Thailand', 'TH', 13.756, 100.502),
  T('ap-seoul', '亚太东北（首尔）', 'Seoul', 'South Korea', 'KR', 37.566, 126.978),
  T('ap-tokyo', '亚太东北（东京）', 'Tokyo', 'Japan', 'JP', 35.676, 139.650),
  T('ap-osaka', '亚太东北（大阪）', 'Osaka', 'Japan', 'JP', 34.694, 135.502),
  T('me-saudi-arabia', '中东（沙特）', 'Riyadh', 'Saudi Arabia', 'SA', 24.713, 46.675),
  T('sa-saopaulo', '南美东部（圣保罗）', 'São Paulo', 'Brazil', 'BR', -23.551, -46.633),
  T('na-queretaro', '北美（克雷塔罗）', 'Querétaro', 'Mexico', 'MX', 20.588, -100.390),
  T('na-siliconvalley', '美国西部（硅谷）', 'Santa Clara', 'United States', 'US', 37.354, -121.955),
  T('na-ashburn', '美国东部（弗吉尼亚）', 'Ashburn', 'United States', 'US', 39.044, -77.487),
  T('eu-frankfurt', '欧洲地区（法兰克福）', 'Frankfurt', 'Germany', 'DE', 50.110, 8.682),
];
