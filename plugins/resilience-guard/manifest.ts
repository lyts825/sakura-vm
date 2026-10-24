/** 明确领域依赖、owner 路由和受管贡献。 Explicit dependencies, owner routes and managed contributions. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
import { resilienceRequests } from '../../shared/contracts/resilience-lab.ts';
const reads = new Set(['view', 'get', 'sources', 'templates', 'catalogue']);
export const manifest = definePlugin({
  id: 'resilience-guard',
  name: '演练监管',
  description: '演练监管的固定修订、独立授权和可核销回执。',
  category: 'development',
  requires: [pin('resilience-targets'), pin('resilience-fixtures')],
  services: ['resilienceGuard'],
  systemDependencies: ['drillSupervision'],
  contributes: {
    http: [http('/api/resilience-guard', ['GET', 'POST'])],
    routes: Object.keys(resilienceRequests.guard).map((id) => ({
      ...ownerDomainRoutes('/api/resilience-guard/' + id)[reads.has(id) ? 0 : 1],
      id,
    })),
  },
});
