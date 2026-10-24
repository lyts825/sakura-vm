/** 将独立演练方法映射为全局线路标识，不扩大领域能力。
 * Map individual drill methods to global route IDs without expanding their authority. */
import type { z } from 'zod';
import {
  resilienceRequests,
  resilienceResponses,
  resilienceScopeSchema,
  resilienceRefSchema,
} from './resilience-lab.ts';
const flatten = (domains: Record<string, Record<string, z.ZodType>>) =>
  Object.fromEntries(
    Object.entries(domains).flatMap(([domain, methods]) =>
      Object.entries(methods).map(([method, schema]) => [`resilience-${domain}.${method}`, schema]),
    ),
  );
const reads = new Set(['view', 'get', 'sources', 'templates', 'catalogue', 'retention', 'imports']);
export const resilienceHttpRequests = Object.fromEntries(
  Object.entries(flatten(resilienceRequests)).filter(([id]) => !reads.has(id.split('.')[1])),
);
export const resilienceHttpQueries = Object.fromEntries(
  Object.entries(resilienceRequests).flatMap(([domain, methods]) =>
    Object.entries(methods)
      .filter(([method]) => reads.has(method))
      .map(([method, schema]) => {
        const shape = schema.shape as Record<string, z.ZodType>;
        return [
          `resilience-${domain}.${method}`,
          {
            ...resilienceScopeSchema.shape,
            ...(shape.id ? { id: shape.id } : {}),
            ...(shape.runId ? { runId: shape.runId } : {}),
            ...(shape.ref ? resilienceRefSchema.shape : {}),
          },
        ];
      }),
  ),
);
export const resilienceHttpResponses = flatten(resilienceResponses);
