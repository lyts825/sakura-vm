/** 调度语义实验的完整成员集合。 */
import {definePack,member} from '../../shared/plugin-protocol.ts';
export const pack=definePack({id:'schedule-semantics-lab',name:"调度语义实验",description:"调度语义实验：定义、处理、复核和交接。",members:[member('schedlab-spaces'),member('schedlab-calendars'),member('schedlab-clocks'),member('schedlab-rules'),member('schedlab-policies'),member('schedlab-workloads'),member('schedlab-scenarios'),member('schedlab-simulations'),member('schedlab-harness'),member('schedlab-observations'),member('schedlab-checks'),member('schedlab-reports'),member('schedlab-exchange'),member('schedlab-workbench')]});
