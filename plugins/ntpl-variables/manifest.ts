/** 变量约定的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ntplRoutes,ntplHttp} from '../../shared/contracts/ntpl-routes.generated.ts';
export const manifest=definePlugin({id:'ntpl-variables',name:"变量约定",description:"字段类型、必填、默认值和敏感标记",category:'development',experimental:true,requires:[pin('ntpl-spaces')],systemDependencies:['notificationRenderCompute'],services:['ntplVariables'],contributes:{http:ntplHttp('variables'),routes:ntplRoutes('variables')}});
