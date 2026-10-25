/** 由 scripts/suite-routes.ts 生成的轻量领域路由索引。 */
import { learningRouteMetadata } from './learning-routes.generated.ts';
import { mediaRouteMetadata } from './media-routes.generated.ts';
import { flowRouteMetadata } from './flow-routes.generated.ts';
import { eventRouteMetadata } from './event-routes.generated.ts';
import { browserRouteMetadata } from './browser-routes.generated.ts';
import { databaseRouteMetadata } from './database-routes.generated.ts';
import { evaluationRouteMetadata } from './evaluation-routes.generated.ts';
import { supplyRouteMetadata } from './supply-routes.generated.ts';
import { localeRouteMetadata } from './locale-routes.generated.ts';
import { incidentRouteMetadata } from './incident-routes.generated.ts';
export const suiteRouteRegistry = {
  learning: learningRouteMetadata,
  media: mediaRouteMetadata,
  flow: flowRouteMetadata,
  event: eventRouteMetadata,
  browser: browserRouteMetadata,
  database: databaseRouteMetadata,
  evaluation: evaluationRouteMetadata,
  supply: supplyRouteMetadata,
  locale: localeRouteMetadata,
  incident: incidentRouteMetadata,
} as const;
export const suiteRootRegistry = {
  "flow": "flow-definitions",
  "media": "media-sources",
  "learning": "learning-courses",
  "event": "event-contracts",
  "browser": "browser-targets",
  "database": "database-sources",
  "evaluation": "evaluation-datasets",
  "supply": "supply-sources",
  "locale": "locale-catalogs",
  "incident": "incident-cases"
} as const;
