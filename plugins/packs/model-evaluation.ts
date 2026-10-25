import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'model-evaluation',
  name: '模型评测工作台',
  description: '固定样例、受管本机文本调用、规则与人工量表、独立模型判分和配对报告。',
  members: [
    member('evaluation-datasets'),
    member('evaluation-prompts'),
    member('evaluation-endpoints'),
    member('evaluation-runners'),
    member('evaluation-scorers'),
    member('evaluation-comparisons'),
    member('evaluation-reviews'),
    member('evaluation-reports'),
    member('evaluation-exchange'),
    member('evaluation-workbench'),
  ],
});
