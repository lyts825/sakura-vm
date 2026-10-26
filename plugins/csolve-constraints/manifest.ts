/** 约束模型的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {csolveRoutes,csolveHttp} from '../../shared/contracts/csolve-routes.generated.ts';
export const manifest=definePlugin({id:'csolve-constraints',name:"约束模型",description:"线性关系、基数和固定时段冲突",category:'development',experimental:true,requires:[pin('csolve-spaces'),pin('csolve-variables'),pin('csolve-domains')],systemDependencies:['constraintSolveSessions'],services:['csolveConstraints'],contributes:{http:csolveHttp('constraints'),routes:csolveRoutes('constraints')}});
