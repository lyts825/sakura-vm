/** 特征空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {featRoutes,featHttp} from '../../shared/contracts/feat-routes.generated.ts';
export const manifest=definePlugin({id:'feat-spaces',name:"特征空间",description:"空间、额度及模板选择",category:'development',experimental:true,requires:[],systemDependencies:['featureTransformCompute'],services:['featSpaces'],contributes:{http:featHttp('spaces'),routes:featRoutes('spaces')}});
