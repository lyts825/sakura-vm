/** 决策变量的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {csolveRoutes,csolveHttp} from '../../shared/contracts/csolve-routes.generated.ts';
export const manifest=definePlugin({id:'csolve-variables',name:"决策变量",description:"稳定变量 ID、中文说明、单位和取值类型",category:'development',experimental:true,requires:[pin('csolve-spaces')],systemDependencies:['constraintSolveSessions'],services:['csolveVariables'],contributes:{http:csolveHttp('variables'),routes:csolveRoutes('variables')}});
