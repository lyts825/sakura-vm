/** 明确领域依赖、owner 路由和受管贡献。 Explicit dependencies, owner routes and managed contributions. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
import { resilienceRequests } from '../../shared/contracts/resilience-lab.ts';
const reads = new Set(['view', 'get', 'sources', 'templates', 'catalogue']);
export const manifest = definePlugin({
  id: 'resilience-runs',
  name: '演练运行',
  description: '演练运行的固定修订、独立授权和可核销回执。',
  category: 'development',
  requires: [
    pin('resilience-targets'),
    pin('resilience-fixtures'),
    pin('resilience-guard'),
    pin('resilience-faults'),
    pin('resilience-probes'),
    pin('resilience-recovery'),
    pin('resilience-scenarios'),
  ],
  services: ['resilienceRuns', 'resilienceActions'],
  systemDependencies: [],
  contributes: {
    managed: ['jobs', 'job-retry'],
    http: [http('/api/resilience-runs', ['GET', 'POST'])],
    routes: Object.keys(resilienceRequests.runs).map((id) => ({
      ...ownerDomainRoutes('/api/resilience-runs/' + id)[reads.has(id) ? 0 : 1],
      id,
    })),
  },
});
