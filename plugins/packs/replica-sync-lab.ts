/** 副本同步实验的完整成员集合。 */
import {definePack,member} from '../../shared/plugin-protocol.ts';
export const pack=definePack({id:'replica-sync-lab',name:"副本同步实验",description:"副本同步实验：定义、处理、复核和交接。",members:[member('replab-spaces'),member('replab-schemas'),member('replab-replicas'),member('replab-operations'),member('replab-clocks'),member('replab-channels'),member('replab-policies'),member('replab-scenarios'),member('replab-runs'),member('replab-conflicts'),member('replab-judgments'),member('replab-reports'),member('replab-exchange'),member('replab-workbench')]});
