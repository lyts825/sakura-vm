/** 明确领域依赖、owner 路由和受管贡献。 Explicit dependencies, owner routes and managed contributions. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
import { resilienceRequests } from '../../shared/contracts/resilience-lab.ts';
const reads = new Set(['view', 'get', 'sources', 'templates', 'catalogue', 'retention', 'imports']);
export const manifest = definePlugin({
  id: 'resilience-reports',
  name: '演练报告',
  description: '演练报告的固定修订、独立授权和可核销回执。',
  category: 'development',
  requires: [
    pin('resilience-runs'),
    pin('resilience-probes'),
    pin('resilience-scenarios'),
    pin('resilience-fixtures'),
  ],
  services: ['resilienceReports'],
  systemDependencies: [],
  contributes: {
    http: [http('/api/resilience-reports', ['GET', 'POST'])],
    routes: Object.keys(resilienceRequests.reports).map((id) => ({
      ...ownerDomainRoutes('/api/resilience-reports/' + id)[reads.has(id) ? 0 : 1],
      id,
    })),
  },
});
