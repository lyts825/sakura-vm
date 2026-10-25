/** 从本地事件范围到可核对的复盘交接；成员各自持有领域能力。 */
import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'incident-desk',
  name: '事件复盘工作台',
  description: '固定案例与证据，编排原功能处置、人工审阅和经过脱敏的复盘交接。',
  members: [
    member('incident-cases'),
    member('incident-evidence'),
    member('incident-timeline'),
    member('incident-hypotheses'),
    member('incident-runbooks'),
    member('incident-actions'),
    member('incident-reviews'),
    member('incident-reports'),
    member('incident-exchange'),
    member('incident-workbench'),
  ],
});
