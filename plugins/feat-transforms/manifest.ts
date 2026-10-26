/** 变换配方的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {featRoutes,featHttp} from '../../shared/contracts/feat-routes.generated.ts';
export const manifest=definePlugin({id:'feat-transforms',name:"变换配方",description:"固定运算节点、类型推导和依赖顺序",category:'development',experimental:true,requires:[pin('feat-spaces'),pin('feat-schemas')],systemDependencies:['featureTransformCompute'],services:['featTransforms'],contributes:{http:featHttp('transforms'),routes:featRoutes('transforms')}});
