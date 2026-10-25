import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { evaluationRoutes, evaluationHttp } from '../../shared/contracts/evaluation-routes.generated.ts';
export const manifest = definePlugin({
  id: 'evaluation-runners',
  name: '模型评测运行',
  description: '固定样例和评分依据，记录来源、许可、差异及单账户审阅。',
  category: 'development',
  experimental: true,
  requires: [pin('evaluation-datasets'), pin('evaluation-prompts'), pin('evaluation-endpoints')],
  optional: [],
  services: ['evaluationRunners'],
  systemDependencies: ['evaluationCalls'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: ['jobs', 'job-retry'],
    http: evaluationHttp('runners'),
    routes: evaluationRoutes('runners'),
  },
});
