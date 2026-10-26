/** 签名核对的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {extforgeRoutes,extforgeHttp} from '../../shared/contracts/extforge-routes.generated.ts';
export const manifest=definePlugin({id:'extforge-signatures',name:"签名核对",description:"待签字节、公钥指纹、外部签名及验证结果",category:'development',experimental:true,requires:[pin('extforge-spaces'),pin('extforge-manifests'),pin('extforge-interfaces'),pin('extforge-builds')],systemDependencies:['extensionTrialRuntime'],services:['extforgeSignatures'],contributes:{http:extforgeHttp('signatures'),routes:extforgeRoutes('signatures')}});
