/** 声明式浏览器验收；网页脚本仅属于固定站点，不成为宿主命令。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import { imageRefSchema } from './image-assets.ts';

export const browserPath = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/)
  .refine(
    (value) => !value.split('/').some((part) => !part || part === '.' || part === '..'),
    '站点路径必须是普通相对路径',
  );
export const browserSelector = z.string().trim().min(1).max(300);
export const browserSite = z
  .object({
    format: z.literal('sakura-browser-site/1'),
    entry: browserPath,
    files: z
      .array(
        z
          .object({
            path: browserPath,
            encoding: z.enum(['utf8', 'base64']),
            data: z.string().max(1024 * 1024),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((site, context) => {
    const paths = site.files.map((file) => file.path.toLowerCase());
    if (new Set(paths).size !== paths.length)
      context.addIssue({ code: 'custom', message: '站点路径重复或大小写冲突' });
    if (!site.files.some((file) => file.path === site.entry))
      context.addIssue({ code: 'custom', message: '入口文件不存在' });
    if (
      site.files.some(
        (file) =>
          file.encoding === 'base64' &&
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data),
      )
    )
      context.addIssue({ code: 'custom', message: '站点包含无效的 Base64 字节' });
    if (site.files.some((file) => !/\.(html?|css|js|json|txt|png|jpe?g|webp|svg|woff2?)$/i.test(file.path)))
      context.addIssue({ code: 'custom', message: '站点含未支持的文件类型' });
  });
export const browserTargetInput = S.suiteScope
  .extend({ name: S.suiteName, source: S.suiteRef, image: imageRefSchema })
  .strict();
export const browserTarget = z
  .object({
    format: z.literal('sakura-browser-target/1'),
    source: S.suiteRef,
    sourceDigest: S.suiteDigest,
    image: imageRefSchema,
    entry: browserPath,
    files: z.number().int().min(1).max(100),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(8 * 1024 ** 2),
    isolatedSite: z.literal(true),
    externalNetwork: z.literal(false),
  })
  .strict();
export const browserFixtureData = z
  .object({
    seed: z.string().min(1).max(100),
    fields: z.record(z.string().regex(/^[a-z][a-zA-Z0-9_]{0,49}$/), z.string().max(4000)),
    localStorage: z.record(z.string().min(1).max(100), z.string().max(4000)),
    cookies: z
      .array(
        z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), value: z.string().max(1000) }).strict(),
      )
      .max(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value.fields).length > 50 || Object.keys(value.localStorage).length > 50)
      context.addIssue({ code: 'custom', message: '合成数据最多 50 个字段及 50 项存储' });
  });
export const browserFixtureInput = S.suiteScope
  .extend({ name: S.suiteName, target: S.suiteRef, data: browserFixtureData })
  .strict();
export const browserFixture = z
  .object({
    format: z.literal('sakura-browser-fixture/1'),
    target: S.suiteRef,
    data: browserFixtureData,
    synthetic: z.literal(true),
  })
  .strict();
const condition = z.object({ selector: browserSelector, exists: z.boolean() }).strict();
const stepBase = { name: z.string().trim().min(1).max(100), when: condition.optional() };
export const browserStep = z.discriminatedUnion('action', [
  z.object({ ...stepBase, action: z.literal('navigate'), path: browserPath }).strict(),
  z.object({ ...stepBase, action: z.literal('click'), selector: browserSelector }).strict(),
  z
    .object({
      ...stepBase,
      action: z.literal('fill'),
      selector: browserSelector,
      value: z.string().max(4000),
    })
    .strict(),
  z
    .object({
      ...stepBase,
      action: z.literal('select'),
      selector: browserSelector,
      value: z.string().max(1000),
    })
    .strict(),
  z
    .object({
      ...stepBase,
      action: z.literal('wait'),
      selector: browserSelector,
      timeoutMs: z.number().int().min(50).max(10000),
    })
    .strict(),
  z.object({ ...stepBase, action: z.literal('screenshot') }).strict(),
]);
export const browserAssertion = z
  .object({
    step: z.number().int().min(0).max(49),
    kind: z.enum(['text', 'element', 'url', 'value']),
    selector: browserSelector.optional(),
    expected: z.string().max(4000),
    comparison: z.enum(['equals', 'contains', 'absent']).default('equals'),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.kind !== 'url' && !rule.selector)
      context.addIssue({ code: 'custom', message: '元素断言需要选择器' });
  });
export const browserVisualRule = z
  .object({
    enabled: z.boolean(),
    tolerance: z.number().min(0).max(1),
    masks: z
      .array(
        z
          .object({
            x: z.number().int().min(0).max(1920),
            y: z.number().int().min(0).max(1080),
            width: z.number().int().min(1).max(1920),
            height: z.number().int().min(1).max(1080),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export const browserAccessibilityRules = z
  .array(z.enum(['document-title', 'image-name', 'control-name', 'heading-order']))
  .max(4);
export const browserJourneyDefinition = z
  .object({
    steps: z.array(browserStep).min(1).max(50),
    assertions: z.array(browserAssertion).max(100),
    viewport: z
      .object({ width: z.number().int().min(320).max(1920), height: z.number().int().min(240).max(1080) })
      .strict(),
    timezone: z.enum(['UTC', 'Asia/Shanghai']),
    visual: browserVisualRule,
    accessibility: browserAccessibilityRules,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.steps.filter((step) => step.action === 'screenshot').length > 10)
      context.addIssue({ code: 'custom', message: '一次运行最多 10 张截图' });
    if (value.assertions.some((rule) => rule.step >= value.steps.length))
      context.addIssue({ code: 'custom', message: '断言引用不存在的步骤' });
    if (new Set(value.accessibility).size !== value.accessibility.length)
      context.addIssue({ code: 'custom', message: '可访问性规则重复' });
    if (value.visual.enabled && !value.steps.some((step) => step.action === 'screenshot'))
      context.addIssue({ code: 'custom', message: '视觉检查需要预先声明截图步骤' });
    if (
      value.visual.masks.some(
        (mask) => mask.x + mask.width > value.viewport.width || mask.y + mask.height > value.viewport.height,
      )
    )
      context.addIssue({ code: 'custom', message: '遮罩超出视口' });
  });
export const browserCompile = S.suiteScope
  .extend({
    name: S.suiteName,
    target: S.suiteRef,
    fixture: S.suiteRef,
    definition: browserJourneyDefinition,
  })
  .strict();
export const browserJourney = z
  .object({
    format: z.literal('sakura-browser-journey/1'),
    target: S.suiteRef,
    fixture: S.suiteRef,
    definition: browserJourneyDefinition,
  })
  .strict();
export const browserRunInput = S.suiteScope
  .extend({
    journey: S.suiteRef,
    baseline: S.suiteRef.nullable().default(null),
    exportArtifacts: z.boolean().default(false),
  })
  .strict();
export const browserRunSelect = S.suiteScope.extend({ run: S.suiteRef }).strict();
export const browserArtifact = z
  .object({
    step: z.number().int().min(0).max(49),
    source: S.suiteRef,
    digest: S.suiteDigest,
    width: z.number().int().positive().max(1920),
    height: z.number().int().positive().max(1080),
  })
  .strict();
export const browserObservation = z
  .object({
    sequence: z.number().int().min(0).max(49),
    name: z.string().max(100),
    action: browserStep.options[0].shape.action.or(z.enum(['click', 'fill', 'select', 'wait', 'screenshot'])),
    status: z.enum(['completed', 'failed', 'skipped', 'inconclusive']),
    elapsedMs: z.number().min(0),
    url: z.string().max(2048),
    domDigest: S.suiteDigest,
    error: z.string().max(1000).nullable(),
    assertions: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(99),
            actual: z.string().max(4000),
            passed: z.boolean(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const browserFinding = z
  .object({
    rule: browserAccessibilityRules.element,
    node: z.string().max(300),
    message: z.string().max(1000),
  })
  .strict();
export const browserToolResult = z
  .object({
    protocol: z.literal('sakura-browser-tool/1'),
    browserVersion: z.string().min(1).max(100),
    fontDigest: S.suiteDigest,
    platform: z.string().min(1).max(100),
    observations: z.array(browserObservation).max(50),
    screenshots: z
      .array(
        z
          .object({
            step: z.number().int().min(0).max(49),
            data: z.string().max(6 * 1024 ** 2),
            digest: S.suiteDigest,
            width: z.number().int().positive().max(1920),
            height: z.number().int().positive().max(1080),
          })
          .strict(),
      )
      .max(10),
    accessibility: z.array(browserFinding).max(1000),
    accessibilityTruncated: z.boolean(),
    blockedRequests: z.array(z.string().max(2048)).max(100),
    completed: z.boolean(),
    error: z.string().max(1000).nullable(),
  })
  .strict();
export const browserWorkerManifest = z
  .object({
    protocol: z.literal('sakura-browser-tool/1'),
    site: browserSite,
    fixture: browserFixtureData,
    journey: browserJourneyDefinition,
  })
  .strict();
export const browserRun = z
  .object({
    format: z.literal('sakura-browser-run/1'),
    journey: S.suiteRef,
    target: S.suiteRef,
    fixture: S.suiteRef,
    baseline: S.suiteRef.nullable(),
    sessionId: S.suiteId,
    sessionDigest: S.suiteDigest,
    executionState: z.enum(['prepared', 'running', 'completed', 'failed', 'cancelled', 'interrupted']),
    cleanup: z.enum(['pending', 'confirmed', 'unknown']),
    outcome: z.enum(['passed', 'failed', 'inconclusive']),
    environment: z
      .object({
        image: imageRefSchema,
        toolDigest: S.suiteDigest,
        browserVersion: z.string().max(100),
        fontDigest: S.suiteDigest,
        platform: z.string().max(100),
        viewport: browserJourneyDefinition.shape.viewport,
        timezone: browserJourneyDefinition.shape.timezone,
      })
      .strict()
      .nullable(),
    observations: z.array(browserObservation).max(50),
    screenshots: z.array(browserArtifact).max(10),
    accessibility: z.array(browserFinding).max(1000),
    accessibilityTruncated: z.boolean(),
    blockedRequests: z.array(z.string().max(2048)).max(100),
    error: z.string().max(1000).nullable(),
    systemExecution: z.literal(true),
  })
  .strict();
export const browserBaselineInput = S.suiteScope
  .extend({ run: S.suiteRef, note: z.string().trim().min(1).max(4000) })
  .strict();
export const browserBaselineDecision = S.suiteScope
  .extend({
    baseline: S.suiteRef,
    expectedActive: S.suiteRef.nullable(),
    note: z.string().trim().min(1).max(4000),
  })
  .strict();
export const browserBaseline = z
  .object({
    format: z.literal('sakura-browser-baseline/1'),
    run: S.suiteRef,
    journey: S.suiteRef,
    environment: browserRun.shape.environment,
    shots: z.array(browserArtifact).min(1).max(10),
    status: z.enum(['proposed', 'active', 'retired']),
    note: z.string().max(4000),
    reviewer: S.suiteId.nullable(),
    previous: S.suiteRef.nullable(),
  })
  .strict();
export const browserCompare = S.suiteScope.extend({ left: S.suiteRef, right: S.suiteRef }).strict();
export const browserReviewInput = S.suiteScope
  .extend({
    evaluation: S.suiteRef,
    note: z.string().trim().min(1).max(4000),
    accepted: z.boolean(),
    manualChecks: z.array(z.string().min(1).max(500)).max(30),
  })
  .strict();
export const browserReportInput = S.suiteScope
  .extend({
    run: S.suiteRef,
    assertions: S.suiteRef,
    visual: S.suiteRef,
    accessibility: S.suiteRef,
    title: S.suiteName,
    note: z.string().max(4000),
  })
  .strict();
export type BrowserToolResult = z.infer<typeof browserToolResult>;
export type BrowserWorkerManifest = z.infer<typeof browserWorkerManifest>;
export type BrowserRun = z.infer<typeof browserRun>;
export const browserAssertionEvaluation = z
  .object({
    format: z.literal('sakura-browser-assertions/1'),
    run: S.suiteRef,
    journey: S.suiteRef,
    checks: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(99),
            rule: browserAssertion,
            observed: z.boolean(),
            passed: z.boolean().nullable(),
            actual: z.string().max(4000).nullable(),
          })
          .strict(),
      )
      .max(100),
    outcome: z.enum(['passed', 'failed', 'inconclusive']),
    coverage: z
      .object({ selected: z.number().int().min(0).max(100), observed: z.number().int().min(0).max(100) })
      .strict(),
  })
  .strict();
export const browserVisualEvaluation = z
  .object({
    format: z.literal('sakura-browser-visual/1'),
    run: S.suiteRef,
    baseline: S.suiteRef.nullable(),
    rule: browserVisualRule,
    comparable: z.boolean(),
    environmentChanged: z.boolean(),
    differences: z
      .array(
        z
          .object({
            step: z.number().int().min(0).max(49),
            comparable: z.boolean(),
            pixels: z.number().int().nonnegative(),
            changed: z.number().int().nonnegative(),
            ratio: z.number().min(0).max(1).nullable(),
          })
          .strict(),
      )
      .max(10),
    outcome: z.enum(['passed', 'failed', 'inconclusive', 'not-selected']),
  })
  .strict();
export const browserAccessibilityEvaluation = z
  .object({
    format: z.literal('sakura-browser-accessibility/1'),
    run: S.suiteRef,
    selected: browserAccessibilityRules,
    findings: z.array(browserFinding).max(1000),
    truncated: z.boolean(),
    outcome: z.enum(['passed', 'failed', 'inconclusive']),
    automatedCoverage: z.literal('selected-dom-rules'),
    manualReview: z
      .object({
        actor: S.suiteId,
        note: z.string().max(4000),
        accepted: z.boolean(),
        checks: z.array(z.string().max(500)).max(30),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const browserReport = z
  .object({
    format: z.literal('sakura-browser-report/1'),
    run: S.suiteRef,
    assertions: S.suiteRef,
    visual: S.suiteRef,
    accessibility: S.suiteRef,
    selected: z.array(z.enum(['assertions', 'visual', 'accessibility'])).max(3),
    notCovered: z.array(z.enum(['assertions', 'visual', 'accessibility'])).max(3),
    outcome: z.enum(['passed', 'failed', 'inconclusive']),
    cleanup: browserRun.shape.cleanup,
    note: z.string().max(4000),
    limitations: z.array(z.string().max(500)).max(10),
    sealed: z.literal(true),
  })
  .strict();
