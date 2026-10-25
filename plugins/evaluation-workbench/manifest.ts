import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { evaluationRoutes, evaluationHttp } from '../../shared/contracts/evaluation-routes.generated.ts';
export const manifest = definePlugin({
  id: 'evaluation-workbench',
  name: '模型评测工作台',
  description: '固定样例和评分依据，记录来源、许可、差异及单账户审阅。',
  category: 'development',
  experimental: true,
  requires: [
    pin('evaluation-datasets'),
    pin('evaluation-prompts'),
    pin('evaluation-endpoints'),
    pin('evaluation-runners'),
    pin('evaluation-scorers'),
    pin('evaluation-comparisons'),
    pin('evaluation-reviews'),
    pin('evaluation-reports'),
    pin('evaluation-exchange'),
  ],
  optional: [],
  services: ['evaluationWorkbench'],
  contributes: {
    pages: ['model-evaluation'],
    tabs: [],
    developmentSections: [],
    managed: [],
    http: evaluationHttp('workbench'),
    routes: evaluationRoutes('workbench'),
  },
});
