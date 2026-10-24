/** 将集成领域的严格输入输出映射到宿主线路标识。
 * Register strict integration domain inputs/outputs under host route IDs. */
import type { z } from 'zod';
import { integrationRequestSchemas, integrationResponseSchemas } from './integration-http.ts';
export const integrationHttpRequests = Object.fromEntries<z.ZodType>(
  Object.entries(integrationRequestSchemas).map(([domain, schema]) => [`integration-${domain}.act`, schema]),
);
export const integrationHttpResponses = Object.fromEntries<z.ZodType>(
  Object.entries(integrationResponseSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([method, schema]) => [`integration-${domain}.${method}`, schema]),
  ),
);
