/** 特征工程工作室的完整成员集合。 */
import {definePack,member} from '../../shared/plugin-protocol.ts';
export const pack=definePack({id:'feature-engineering-studio',name:"特征工程工作室",description:"特征工程工作室：定义、处理、复核和交接。",members:[member('feat-spaces'),member('feat-sources'),member('feat-schemas'),member('feat-partitions'),member('feat-transforms'),member('feat-joins'),member('feat-windows'),member('feat-fits'),member('feat-selections'),member('feat-runs'),member('feat-checks'),member('feat-artifacts'),member('feat-reviews'),member('feat-exchange'),member('feat-workbench')]});
