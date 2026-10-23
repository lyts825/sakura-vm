/** 工坊各插件的公共 HTTP 请求和响应模式。 */
import { foundrySections, foundryActionSchema, foundryScopeSchema, foundryViewSchema, foundryResultSchema } from './foundry.ts';
import type { HttpResponseContract } from './http-response.ts';

export const foundryHttpRequests = Object.fromEntries(foundrySections.map(section => [`foundry-${section}.act`, foundryActionSchema]));
export const foundryHttpQueries = Object.fromEntries(foundrySections.flatMap(section => ['view', 'act'].map(action => [`foundry-${section}.${action}`, foundryScopeSchema.shape])));
export const foundryHttpResponses = Object.fromEntries<HttpResponseContract>(foundrySections.flatMap(section => [
  [`foundry-${section}.view`, { kind: 'json' as const, statuses: [200], media: 'application/json', schema: foundryViewSchema }],
  [`foundry-${section}.act`, { kind: 'json' as const, statuses: [200], media: 'application/json', schema: foundryResultSchema }],
]));
