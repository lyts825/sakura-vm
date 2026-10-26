/** 目标模型的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {csolveRoutes,csolveHttp} from '../../shared/contracts/csolve-routes.generated.ts';
export const manifest=definePlugin({id:'csolve-objectives',name:"目标模型",description:"线性目标、方向、分层优先级和系数",category:'development',experimental:true,requires:[pin('csolve-spaces'),pin('csolve-variables'),pin('csolve-domains')],systemDependencies:['constraintSolveSessions'],services:['csolveObjectives'],contributes:{http:csolveHttp('objectives'),routes:csolveRoutes('objectives')}});
