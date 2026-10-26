/** 归并空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {entitydeskRoutes,entitydeskHttp} from '../../shared/contracts/entitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'entitydesk-spaces',name:"归并空间",description:"空间、授权和额度",category:'development',experimental:true,requires:[],systemDependencies:['entityMatchingCompute'],services:['entitydeskSpaces'],contributes:{http:entitydeskHttp('spaces'),routes:entitydeskRoutes('spaces')}});
