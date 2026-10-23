/** 环境配置预览的公开数据契约。 Public contracts for environment configuration previews. */
import { z } from 'zod';

export const recipeChangeSchema = z.object({
  field: z.string(), before: z.string(), after: z.string(),
  disposition: z.enum(['apply', 'stop-required', 'rebuild-required', 'separate-operation', 'unsupported']),
  reason: z.string(),
}).strict();
export const recipePlanSchema = z.object({
  token: z.uuid(), expiresAt: z.iso.datetime(), vmId: z.string(), projectId: z.string(),
  inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  configurationSha256: z.string().regex(/^[a-f0-9]{64}$/),
  resourceDeclarationSha256: z.string().regex(/^[a-f0-9]{64}$/),
  canApply: z.boolean(), unchanged: z.boolean(), changes: z.array(recipeChangeSchema),
  runtimeVerification: z.literal('not-probed'),
  dependencyVerification: z.literal('not-probed'),
  imageVerification: z.literal('not-probed'), warnings: z.array(z.string()),
}).strict();
export const recipeApplyPlanRequestSchema = z.object({ token: z.uuid() }).strict();
export type RecipePlan = z.infer<typeof recipePlanSchema>;
export type RecipeChange = z.infer<typeof recipeChangeSchema>;
