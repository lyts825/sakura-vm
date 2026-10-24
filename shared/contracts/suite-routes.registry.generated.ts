/** 由 scripts/suite-routes.ts 生成的轻量领域路由索引。 */
import { supplyRouteMetadata } from './supply-routes.generated.ts';
import { localeRouteMetadata } from './locale-routes.generated.ts';
export const suiteRouteRegistry = {
  supply: supplyRouteMetadata,
  locale: localeRouteMetadata,
} as const;
