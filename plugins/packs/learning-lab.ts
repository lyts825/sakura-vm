import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'learning-lab',
  name: '交互式实验',
  description: '固定课程、真实文件练习、受限本机请求、检查点和所有者自学记录。',
  members: [
    member('learning-courses'),
    member('learning-assets'),
    member('learning-lessons'),
    member('learning-environments'),
    member('learning-steps'),
    member('learning-checks'),
    member('learning-sessions'),
    member('learning-progress'),
    member('learning-assessments'),
    member('learning-exchange'),
    member('learning-workbench'),
  ],
});
