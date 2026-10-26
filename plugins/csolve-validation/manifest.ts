/** 独立验证的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {csolveRoutes,csolveHttp} from '../../shared/contracts/csolve-routes.generated.ts';
export const manifest=definePlugin({id:'csolve-validation',name:"独立验证",description:"按原模型重新计算的逐约束结果",category:'development',experimental:true,requires:[pin('csolve-spaces'),pin('csolve-variables'),pin('csolve-domains'),pin('csolve-constraints'),pin('csolve-objectives'),pin('csolve-scenarios'),pin('csolve-solutions')],systemDependencies:['constraintSolveSessions'],services:['csolveValidation'],contributes:{http:csolveHttp('validation'),routes:csolveRoutes('validation')}});
