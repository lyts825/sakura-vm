/** 明确领域依赖、owner 路由和受管贡献。 Explicit dependencies, owner routes and managed contributions. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
import { resilienceRequests } from '../../shared/contracts/resilience-lab.ts';
const reads = new Set(['view', 'get', 'sources', 'templates', 'catalogue']);
export const manifest = definePlugin({
  id: 'resilience-targets',
  name: '演练来源',
  description: '演练来源的固定修订、独立授权和可核销回执。',
  category: 'development',
  requires: [pin('projects')],
  services: ['resilienceTargets'],
  systemDependencies: [],
  contributes: {
    http: [http('/api/resilience-targets', ['GET', 'POST'])],
    routes: Object.keys(resilienceRequests.targets).map((id) => ({
      ...ownerDomainRoutes('/api/resilience-targets/' + id)[reads.has(id) ? 0 : 1],
      id,
    })),
  },
});
