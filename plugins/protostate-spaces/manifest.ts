/** 协议空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {protostateRoutes,protostateHttp} from '../../shared/contracts/protostate-routes.generated.ts';
export const manifest=definePlugin({id:'protostate-spaces',name:"协议空间",description:"空间、授权修订和额度根账本",category:'development',experimental:true,requires:[],systemDependencies:['protocolScenarioSessions'],services:['protostateSpaces'],contributes:{http:protostateHttp('spaces'),routes:protostateRoutes('spaces')}});
