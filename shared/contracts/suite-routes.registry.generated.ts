/** 由 scripts/suite-routes.ts 生成的轻量领域路由索引。 */
import { qualitydeskRouteMetadata } from './qualitydesk-routes.generated.ts';
import { lineageatlasRouteMetadata } from './lineageatlas-routes.generated.ts';
import { entitydeskRouteMetadata } from './entitydesk-routes.generated.ts';
import { temporaldeskRouteMetadata } from './temporaldesk-routes.generated.ts';
import { geodeskRouteMetadata } from './geodesk-routes.generated.ts';
import { graphdeskRouteMetadata } from './graphdesk-routes.generated.ts';
import { trialplanRouteMetadata } from './trialplan-routes.generated.ts';
import { featRouteMetadata } from './feat-routes.generated.ts';
import { ctrainRouteMetadata } from './ctrain-routes.generated.ts';
import { csolveRouteMetadata } from './csolve-routes.generated.ts';
import { dextractRouteMetadata } from './dextract-routes.generated.ts';
import { dsysRouteMetadata } from './dsys-routes.generated.ts';
import { fformRouteMetadata } from './fform-routes.generated.ts';
import { ntplRouteMetadata } from './ntpl-routes.generated.ts';
import { schedlabRouteMetadata } from './schedlab-routes.generated.ts';
import { extforgeRouteMetadata } from './extforge-routes.generated.ts';
import { depsolveRouteMetadata } from './depsolve-routes.generated.ts';
import { protostateRouteMetadata } from './protostate-routes.generated.ts';
import { replabRouteMetadata } from './replab-routes.generated.ts';
import { virtserviceRouteMetadata } from './virtservice-routes.generated.ts';
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
  qualitydesk: qualitydeskRouteMetadata,
  lineageatlas: lineageatlasRouteMetadata,
  entitydesk: entitydeskRouteMetadata,
  temporaldesk: temporaldeskRouteMetadata,
  geodesk: geodeskRouteMetadata,
  graphdesk: graphdeskRouteMetadata,
  trialplan: trialplanRouteMetadata,
  feat: featRouteMetadata,
  ctrain: ctrainRouteMetadata,
  csolve: csolveRouteMetadata,
  dextract: dextractRouteMetadata,
  dsys: dsysRouteMetadata,
  fform: fformRouteMetadata,
  ntpl: ntplRouteMetadata,
  schedlab: schedlabRouteMetadata,
  extforge: extforgeRouteMetadata,
  depsolve: depsolveRouteMetadata,
  protostate: protostateRouteMetadata,
  replab: replabRouteMetadata,
  virtservice: virtserviceRouteMetadata,
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
  "qualitydesk": "qualitydesk-spaces",
  "lineageatlas": "lineageatlas-spaces",
  "entitydesk": "entitydesk-spaces",
  "temporaldesk": "temporaldesk-spaces",
  "geodesk": "geodesk-spaces",
  "graphdesk": "graphdesk-spaces",
  "trialplan": "trialplan-spaces",
  "feat": "feat-spaces",
  "ctrain": "ctrain-spaces",
  "csolve": "csolve-spaces",
  "dextract": "dextract-spaces",
  "dsys": "dsys-spaces",
  "fform": "fform-spaces",
  "ntpl": "ntpl-spaces",
  "schedlab": "schedlab-spaces",
  "extforge": "extforge-spaces",
  "depsolve": "depsolve-spaces",
  "protostate": "protostate-spaces",
  "replab": "replab-spaces",
  "virtservice": "virtservice-spaces",
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
