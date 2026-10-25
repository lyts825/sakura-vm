/** 事件 HTTP 仅公开声明与原作用域操作，不公开内部会话委派。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import * as E from './event-lab.ts';
import { imageAssetSchema } from './image-assets.ts';
import {
  suiteMethod as m,
  suiteControls,
  suiteMaterialMethods,
  suiteExchangeMethods,
  suiteEmpty,
} from './suite-http.ts';
export const eventHttpSchemas = {
  contracts: {
    ...suiteMaterialMethods(),
    images: m(suiteEmpty, z.array(imageAssetSchema).max(1000), true),
    upload: m(E.eventUpload, S.suiteRecord),
    validate: m(E.eventContractInput, S.suiteRecord),
    compare: m(E.eventCompare, S.suiteRecord),
  },
  fixtures: {
    ...suiteControls(),
    generate: m(E.eventGenerate, S.suiteRecord),
    importRows: m(E.eventImportRows, S.suiteRecord),
  },
  producers: {
    ...suiteControls(),
    compile: m(E.eventProducerInput, S.suiteRecord),
    previewMessages: m(E.eventSelect('producer'), S.suiteRecord, true),
  },
  consumers: {
    ...suiteControls(),
    compile: m(E.eventConsumerInput, S.suiteRecord),
    validatePolicy: m(E.eventSelect('consumer'), S.suiteRecord, true),
  },
  scenarios: {
    ...suiteControls(),
    compile: m(E.eventScenarioInput, S.suiteRecord),
    preview: m(E.eventSelect('scenario'), S.suiteRecord, true),
  },
  brokers: {
    ...suiteControls(),
    prepare: m(E.eventPrepare, S.suiteRecord),
    observe: m(E.eventSelect('broker'), S.suiteRecord, true),
  },
  runs: {
    ...suiteControls(),
    preview: m(E.eventRunPreview, S.suitePlan),
    start: m(S.suiteApproval, S.suiteRecord),
    inspect: m(E.eventSelect('run'), S.suiteRecord),
    cancel: m(E.eventSelect('run'), S.suiteRecord),
    reconcile: m(E.eventSelect('run'), S.suiteRecord),
    discardPreview: m(S.suiteApproval, S.suitePlan),
  },
  assertions: {
    ...suiteControls(),
    evaluate: m(E.eventSelect('run'), S.suiteRecord),
    explain: m(E.eventSelect('assertion'), S.suiteRecord, true),
  },
  reports: {
    ...suiteControls(),
    sealReport: m(E.eventReportInput, S.suiteRecord),
    compare: m(E.eventCompare, S.suiteRecord),
  },
  exchange: { ...suiteExchangeMethods() },
  workbench: {
    ...suiteControls(),
    templates: m(suiteEmpty, z.array(E.eventTemplate).max(3), true),
    createExample: m(E.eventExample, E.eventExampleResult),
    view: m(E.eventViewInput, E.eventView, true),
  },
} as const;
export const eventHttpRequests = Object.fromEntries(
  Object.entries(eventHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([name, schema]) => [`event-${domain}.${name}`, schema.request]),
  ),
);
export const eventHttpResponses = Object.fromEntries(
  Object.entries(eventHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([name, schema]) => [`event-${domain}.${name}`, schema.response]),
  ),
);
