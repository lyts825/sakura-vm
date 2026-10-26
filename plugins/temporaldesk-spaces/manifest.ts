/** 时间空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {temporaldeskRoutes,temporaldeskHttp} from '../../shared/contracts/temporaldesk-routes.generated.ts';
export const manifest=definePlugin({id:'temporaldesk-spaces',name:"时间空间",description:"空间、授权和额度",category:'development',experimental:true,requires:[],systemDependencies:['temporalSeriesCompute'],services:['temporaldeskSpaces'],contributes:{http:temporaldeskHttp('spaces'),routes:temporaldeskRoutes('spaces')}});
