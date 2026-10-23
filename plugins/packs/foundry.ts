/** 镜像工坊完整包。 */
import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'foundry',
  name: '环境镜像工坊',
  description: '固定来源、离线制作、清理身份、双实例验收和镜像交接。',
  members: [
    member('foundry-sources'),
    member('foundry-blueprints'),
    member('foundry-depot'),
    member('foundry-builders'),
    member('foundry-sanitizers'),
    member('foundry-checks'),
    member('foundry-catalog'),
    member('foundry-exchange'),
    member('foundry-workbench'),
  ],
});
