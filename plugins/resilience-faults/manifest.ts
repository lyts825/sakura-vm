/** 明确领域依赖、owner 路由和受管贡献。 Explicit dependencies, owner routes and managed contributions. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
import { resilienceRequests } from '../../shared/contracts/resilience-lab.ts';
const reads = new Set(['view', 'get', 'sources', 'templates', 'catalogue']);
export const manifest = definePlugin({
  id: 'resilience-faults',
  name: '故障目录',
  description: '故障目录的固定修订、独立授权和可核销回执。',
  category: 'development',
  requires: [pin('resilience-targets'), pin('resilience-guard')],
  services: ['resilienceFaults'],
  systemDependencies: ['drillSupervision'],
  contributes: {
    http: [http('/api/resilience-faults', ['GET', 'POST'])],
    routes: Object.keys(resilienceRequests.faults).map((id) => ({
      ...ownerDomainRoutes('/api/resilience-faults/' + id)[reads.has(id) ? 0 : 1],
      id,
    })),
  },
});
