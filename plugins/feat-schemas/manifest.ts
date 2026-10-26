/** 特征类型的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {featRoutes,featHttp} from '../../shared/contracts/feat-routes.generated.ts';
export const manifest=definePlugin({id:'feat-schemas',name:"特征类型",description:"列角色、缺失标记、类别和数值域",category:'development',experimental:true,requires:[pin('feat-spaces'),pin('feat-sources')],systemDependencies:['featureTransformCompute'],services:['featSchemas'],contributes:{http:featHttp('schemas'),routes:featRoutes('schemas')}});
