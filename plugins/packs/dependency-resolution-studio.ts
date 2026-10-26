/** 依赖求解工作室的完整成员集合。 */
import {definePack,member} from '../../shared/plugin-protocol.ts';
export const pack=definePack({id:'dependency-resolution-studio',name:"依赖求解工作室",description:"依赖求解工作室：定义、处理、复核和交接。",members:[member('depsolve-spaces'),member('depsolve-catalogs'),member('depsolve-roots'),member('depsolve-platforms'),member('depsolve-constraints'),member('depsolve-candidates'),member('depsolve-solves'),member('depsolve-proofs'),member('depsolve-comparisons'),member('depsolve-locks'),member('depsolve-reports'),member('depsolve-exchange'),member('depsolve-workbench')]});
