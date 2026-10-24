/** 明确领域依赖、owner 路由和受管贡献。 Explicit dependencies, owner routes and managed contributions. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
import { resilienceRequests } from '../../shared/contracts/resilience-lab.ts';
const reads = new Set(['view', 'get', 'sources', 'templates', 'catalogue']);
export const manifest = definePlugin({
  id: 'resilience-workbench',
  name: '可靠性演练',
  description: '可靠性演练的固定修订、独立授权和可核销回执。',
  category: 'development',
  requires: [
    pin('resilience-targets'),
    pin('resilience-fixtures'),
    pin('resilience-guard'),
    pin('resilience-faults'),
    pin('resilience-probes'),
    pin('resilience-recovery'),
    pin('resilience-scenarios'),
    pin('resilience-runs'),
    pin('resilience-reports'),
  ],
  services: ['resilienceWorkbench'],
  systemDependencies: [],
  contributes: {
    pages: ['resilience-workbench'],
    http: [http('/api/resilience-workbench', ['GET'])],
    routes: Object.keys(resilienceRequests.workbench).map((id) => ({
      ...ownerDomainRoutes('/api/resilience-workbench/' + id)[reads.has(id) ? 0 : 1],
      id,
    })),
  },
});
