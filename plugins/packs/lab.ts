import { definePack, member } from '../../shared/plugin-protocol.ts';

export const pack = definePack({
  id: 'lab',
  name: '实验室',
  description: '显式选择自动化、实验性扩展、容器和虚拟机沙箱。',
  members: [
    member('automation'),
    member('automation-scheduler'),
    member('extensions'),
    member('platform'),
    member('containers'),
    member('sandbox'),
  ],
});
