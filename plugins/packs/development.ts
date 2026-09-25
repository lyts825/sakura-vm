import { definePack, member } from '../../shared/plugin-protocol.ts';

export const pack = definePack({
  id: 'development',
  name: '开发工具组合',
  description: '工具、搜索、检查、命令、流水线与运行时，可逐项启用。',
  members: [
    member('toolchains'),
    member('project-search'),
    member('code-checks'),
    member('commands'),
    member('pipelines'),
    member('runtimes'),
  ],
  replacesPlugins: ['development'],
});
