/** 明确领域依赖、owner 路由和受管贡献。 Explicit dependencies, owner routes and managed contributions. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
import { resilienceRequests } from '../../shared/contracts/resilience-lab.ts';
const reads = new Set(['view', 'get', 'sources', 'templates', 'catalogue']);
export const manifest = definePlugin({
  id: 'resilience-scenarios',
  name: '演练场景',
  description: '演练场景的固定修订、独立授权和可核销回执。',
  category: 'development',
  requires: [
    pin('resilience-targets'),
    pin('resilience-faults'),
    pin('resilience-probes'),
    pin('resilience-recovery'),
  ],
  services: ['resilienceScenarios'],
  systemDependencies: [],
  contributes: {
    http: [http('/api/resilience-scenarios', ['GET', 'POST'])],
    routes: Object.keys(resilienceRequests.scenarios).map((id) => ({
      ...ownerDomainRoutes('/api/resilience-scenarios/' + id)[reads.has(id) ? 0 : 1],
      id,
    })),
  },
});
