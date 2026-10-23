/** 应用运行完整包；独立于其他场景整合包。 */
import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'app-runtime',
  name: '应用运行与运维',
  description: '从本地制品到持续运行、健康入口、升级和冷备恢复。',
  members: [
    member('app-targets'),
    member('app-packages'),
    member('app-config'),
    member('app-data'),
    member('app-observe'),
    member('app-routes'),
    member('app-recovery'),
    member('app-deploy'),
    member('app-workbench'),
    member('command-palette'),
  ],
});
