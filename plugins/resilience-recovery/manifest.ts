/** 明确领域依赖、owner 路由和受管贡献。 Explicit dependencies, owner routes and managed contributions. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
import { resilienceRequests } from '../../shared/contracts/resilience-lab.ts';
const reads = new Set(['view', 'get', 'sources', 'templates', 'catalogue']);
export const manifest = definePlugin({
  id: 'resilience-recovery',
  name: '恢复策略',
  description: '恢复策略的固定修订、独立授权和可核销回执。',
  category: 'development',
  requires: [
    pin('resilience-targets'),
    pin('resilience-fixtures'),
    pin('resilience-guard'),
    pin('resilience-probes'),
  ],
  services: ['resilienceRecovery'],
  systemDependencies: ['drillSupervision'],
  contributes: {
    http: [http('/api/resilience-recovery', ['POST'])],
    routes: Object.keys(resilienceRequests.recovery).map((id) => ({
      ...ownerDomainRoutes('/api/resilience-recovery/' + id)[reads.has(id) ? 0 : 1],
      id,
    })),
  },
});
