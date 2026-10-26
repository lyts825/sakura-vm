/** 响应材料的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {virtserviceRoutes,virtserviceHttp} from '../../shared/contracts/virtservice-routes.generated.ts';
export const manifest=definePlugin({id:'virtservice-payloads',name:"响应材料",description:"固定正文、字段映射及虚构数据集",category:'development',experimental:true,requires:[pin('virtservice-spaces'),pin('virtservice-contracts')],systemDependencies:['multiServiceVirtualizationSessions'],services:['virtservicePayloads'],contributes:{http:virtserviceHttp('payloads'),routes:virtserviceRoutes('payloads')}});
