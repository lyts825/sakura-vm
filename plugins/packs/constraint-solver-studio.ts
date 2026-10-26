/** 约束求解工作室的完整成员集合。 */
import {definePack,member} from '../../shared/plugin-protocol.ts';
export const pack=definePack({id:'constraint-solver-studio',name:"约束求解工作室",description:"约束求解工作室：定义、处理、复核和交接。",members:[member('csolve-spaces'),member('csolve-variables'),member('csolve-domains'),member('csolve-constraints'),member('csolve-objectives'),member('csolve-scenarios'),member('csolve-runs'),member('csolve-solutions'),member('csolve-validation'),member('csolve-conflicts'),member('csolve-sensitivity'),member('csolve-decisions'),member('csolve-exchange'),member('csolve-workbench')]});
