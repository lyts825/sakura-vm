import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { evaluationRoutes, evaluationHttp } from '../../shared/contracts/evaluation-routes.generated.ts';
export const manifest = definePlugin({
  id: 'evaluation-endpoints',
  name: '本机模型端点',
  description: '固定样例和评分依据，记录来源、许可、差异及单账户审阅。',
  category: 'development',
  experimental: true,
  requires: [pin('evaluation-datasets'), pin('secrets')],
  optional: [],
  services: ['evaluationEndpoints'],
  systemDependencies: ['evaluationCalls'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: evaluationHttp('endpoints'),
    routes: evaluationRoutes('endpoints'),
  },
});
