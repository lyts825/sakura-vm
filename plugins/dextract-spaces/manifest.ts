/** 提取空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dextractRoutes,dextractHttp} from '../../shared/contracts/dextract-routes.generated.ts';
export const manifest=definePlugin({id:'dextract-spaces',name:"提取空间",description:"空间、额度、模板与访问修订",category:'development',experimental:true,requires:[],systemDependencies:['documentExtractionSessions'],services:['dextractSpaces'],contributes:{http:dextractHttp('spaces'),routes:dextractRoutes('spaces')}});
