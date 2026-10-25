/** 浏览器包逐方法请求与响应，内部截图发布能力不进入 HTTP。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import * as B from './browser-lab.ts';
import * as E from './suite-execution.ts';
import { imageAssetSchema, imageRefSchema } from './image-assets.ts';
import {
  suiteMethod as method,
  suiteEmpty,
  suiteControls as controls,
  suiteMaterialMethods,
  suiteExchangeMethods,
} from './suite-http.ts';

export const browserTemplate = z
  .object({
    id: z.enum(['form-submit', 'responsive-navigation', 'visual-change']),
    name: S.suiteName,
    description: z.string().max(1000),
    site: B.browserSite,
    fixture: B.browserFixtureData,
    journey: B.browserJourneyDefinition,
  })
  .strict();
export const browserExampleInput = z
  .object({ name: S.suiteName, template: browserTemplate.shape.id, image: imageRefSchema })
  .strict();
export const browserViewInput = z
  .object({
    workspaceId: S.suiteId.optional(),
    cursor: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(30).optional(),
    history: z.boolean().optional(),
  })
  .strict();
export const browserHttpSchemas = {
  targets: {
    ...suiteMaterialMethods(),
    images: method(suiteEmpty, z.array(imageAssetSchema).max(1000), true),
    upload: method(
      S.suiteScope
        .extend({ name: S.suiteName, site: B.browserSite, allowExport: z.boolean().default(false) })
        .strict(),
      S.suiteRecord,
    ),
    pin: method(B.browserTargetInput, S.suiteRecord),
    resolve: method(S.suitePin, S.suiteRecord, true),
  },
  fixtures: {
    ...controls(),
    generate: method(B.browserFixtureInput, S.suiteRecord),
    validate: method(S.suitePin, S.suiteRecord, true),
  },
  journeys: {
    ...controls(),
    compile: method(B.browserCompile, S.suiteRecord),
    previewSteps: method(S.suitePin, S.suiteRecord, true),
  },
  runners: {
    ...controls(),
    tool: method(suiteEmpty, E.suiteExecutionTool, true),
    preview: method(B.browserRunInput, S.suitePlan),
    start: method(S.suiteApproval, S.suiteRecord),
    discardPreview: method(S.suiteApproval, S.suitePlan),
    inspect: method(B.browserRunSelect, S.suiteRecord, true),
    cancel: method(B.browserRunSelect, E.suiteExecutionReceipt),
    reconcile: method(B.browserRunSelect, E.suiteExecutionReceipt),
  },
  assertions: {
    ...controls(),
    evaluate: method(B.browserRunSelect, S.suiteRecord),
    explain: method(S.suitePin, S.suiteRecord, true),
  },
  visual: {
    ...controls(),
    proposeBaseline: method(B.browserBaselineInput, S.suiteRecord),
    acceptBaseline: method(B.browserBaselineDecision, S.suiteRecord),
    active: method(S.suiteScope.extend({ journey: S.suiteRef }).strict(), S.suiteRecord.nullable(), true),
    compare: method(B.browserRunSelect, S.suiteRecord),
  },
  accessibility: {
    ...controls(),
    evaluate: method(B.browserRunSelect, S.suiteRecord),
    review: method(B.browserReviewInput, S.suiteRecord),
  },
  reports: {
    ...controls(),
    seal: method(B.browserReportInput, S.suiteRecord),
    compare: method(B.browserCompare, S.suiteRecord),
  },
  exchange: { ...suiteExchangeMethods() },
  workbench: {
    ...controls(),
    templates: method(suiteEmpty, z.array(browserTemplate).length(3), true),
    createExample: method(
      browserExampleInput,
      z
        .object({
          workspace: S.suiteWorkspace,
          source: S.suiteRecord,
          target: S.suiteRecord,
          fixture: S.suiteRecord,
          journey: S.suiteRecord,
        })
        .strict(),
    ),
    view: method(
      browserViewInput,
      z
        .object({
          workspaces: z.array(S.suiteWorkspace).max(50),
          workspace: S.suiteWorkspace.nullable(),
          domains: z
            .array(
              z
                .object({
                  id: S.suiteRef.shape.domain,
                  records: z.array(S.suiteRecord).max(30),
                  next: z.number().int().nonnegative().nullable(),
                })
                .strict(),
            )
            .max(9),
        })
        .strict(),
      true,
    ),
  },
} as const;
export type BrowserRequests = {
  [D in keyof typeof browserHttpSchemas]: {
    [M in keyof (typeof browserHttpSchemas)[D]]: (typeof browserHttpSchemas)[D][M] extends {
      request: infer T extends z.ZodType;
    }
      ? z.input<T>
      : never;
  };
};
export type BrowserResponses = {
  [D in keyof typeof browserHttpSchemas]: {
    [M in keyof (typeof browserHttpSchemas)[D]]: (typeof browserHttpSchemas)[D][M] extends {
      response: infer T extends z.ZodType;
    }
      ? z.output<T>
      : never;
  };
};
export const browserHttpRequests = Object.fromEntries(
  Object.entries(browserHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([method, schema]) => [`browser-${domain}.${method}`, schema.request]),
  ),
);
export const browserHttpResponses = Object.fromEntries(
  Object.entries(browserHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([method, schema]) => [`browser-${domain}.${method}`, schema.response]),
  ),
);
