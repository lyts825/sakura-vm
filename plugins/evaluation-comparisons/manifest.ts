import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { evaluationRoutes, evaluationHttp } from '../../shared/contracts/evaluation-routes.generated.ts';
export const manifest = definePlugin({
  id: 'evaluation-comparisons',
  name: '配对比较',
  description: '固定样例和评分依据，记录来源、许可、差异及单账户审阅。',
  category: 'development',
  experimental: true,
  requires: [
    pin('evaluation-datasets'),
    pin('evaluation-prompts'),
    pin('evaluation-runners'),
    pin('evaluation-scorers'),
  ],
  optional: [],
  services: ['evaluationComparisons'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: evaluationHttp('comparisons'),
    routes: evaluationRoutes('comparisons'),
  },
});
