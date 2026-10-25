/** 数据库领域 HTTP 方法逐项登记；运行许可和意图回调不对客户端公开。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import * as D from './database-evolution.ts';
import {
  suiteMethod as m,
  suiteControls,
  suiteMaterialMethods,
  suiteExchangeMethods,
  suiteEmpty,
} from './suite-http.ts';
export const databaseHttpSchemas = {
  sources: {
    ...suiteMaterialMethods(),
    upload: m(D.databaseUpload, S.suiteRecord),
    generate: m(D.databaseGenerate, S.suiteRecord),
    pin: m(D.databasePin, S.suiteRecord),
    importRows: m(D.databaseImportRows, S.suiteRecord),
  },
  schemas: {
    ...suiteControls(),
    validate: m(D.databaseSelect('source'), S.suiteRecord),
    compare: m(D.databaseCompare, S.suiteRecord),
  },
  changes: {
    ...suiteControls(),
    compile: m(D.databaseCompile, S.suiteRecord),
    riskSummary: m(D.databaseSelect('changes'), S.suiteRecord, true),
  },
  fixtures: {
    ...suiteControls(),
    cancel: m(D.databaseSelect('fixture'), S.suiteRecord),
    discardPreview: m(S.suiteApproval, S.suitePlan),
    prepare: m(D.databaseFixturePrepare, S.suitePlan),
    checkpoint: m(S.suiteApproval, S.suiteRecord),
    inspect: m(D.databaseSelect('fixture'), S.suiteRecord),
    cleanupPreview: m(D.databaseSelect('fixture'), S.suitePlan),
  },
  runners: {
    ...suiteControls(),
    discardPreview: m(S.suiteApproval, S.suitePlan),
    preview: m(D.databaseRunPreview, S.suitePlan),
    execute: m(S.suiteApproval, S.suiteRecord),
    inspect: m(D.databaseRunAction, S.suiteRecord),
    cancel: m(D.databaseRunAction, S.suiteRecord),
    reconcile: m(D.databaseRunAction, S.suitePlan),
    confirmReconcile: m(S.suiteApproval, S.suiteRecord),
    previewRestore: m(D.databaseRecovery, S.suitePlan),
    restore: m(S.suiteApproval, S.suiteRecord),
  },
  checks: {
    ...suiteControls(),
    evaluate: m(D.databaseRunAction, S.suiteRecord),
    explain: m(D.databaseSelect('check'), S.suiteRecord, true),
  },
  rehearsals: {
    ...suiteControls(),
    discardPreview: m(S.suiteApproval, S.suitePlan),
    preview: m(D.databaseRunPreview, S.suitePlan),
    start: m(S.suiteApproval, S.suiteRecord),
    inspect: m(D.databaseSelect('rehearsal'), S.suiteRecord),
    cancel: m(D.databaseSelect('rehearsal'), S.suiteRecord),
    recover: m(
      D.databaseSelect('rehearsal').extend({ image: D.databaseFixturePrepare.shape.image }).strict(),
      S.suitePlan,
    ),
    confirmRecovery: m(S.suiteApproval, S.suiteRecord),
  },
  reports: {
    ...suiteControls(),
    sealReport: m(D.databaseReportInput, S.suiteRecord),
    compare: m(D.databaseCompare, S.suiteRecord),
  },
  exchange: { ...suiteExchangeMethods() },
  workbench: {
    ...suiteControls(),
    templates: m(suiteEmpty, D.databaseWorkbenchTemplates, true),
    view: m(D.databaseWorkbenchRequest, D.databaseWorkbenchView, true),
  },
} as const;
export const databaseHttpRequests = Object.fromEntries(
  Object.entries(databaseHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([name, schema]) => [`database-${domain}.${name}`, schema.request]),
  ),
);
export const databaseHttpResponses = Object.fromEntries(
  Object.entries(databaseHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([name, schema]) => [`database-${domain}.${name}`, schema.response]),
  ),
);
