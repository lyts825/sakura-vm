import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { evaluationRoutes, evaluationHttp } from '../../shared/contracts/evaluation-routes.generated.ts';
export const manifest = definePlugin({
  id: 'evaluation-reviews',
  name: '评测审阅',
  description: '固定样例和评分依据，记录来源、许可、差异及单账户审阅。',
  category: 'development',
  experimental: true,
  requires: [pin('evaluation-datasets'), pin('evaluation-comparisons')],
  optional: [],
  services: ['evaluationReviews'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: evaluationHttp('reviews'),
    routes: evaluationRoutes('reviews'),
  },
});
