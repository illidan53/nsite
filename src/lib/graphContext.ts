import { createContext, useContext } from 'react';
import type { RouteGraph } from './routing.ts';

/** 海缆 + 陆地路由图，给 traceroute 详情推测相邻两跳之间的物理路径用。 */
export const RouteGraphContext = createContext<RouteGraph | null>(null);

export const useRouteGraph = () => useContext(RouteGraphContext);
