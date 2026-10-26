/** 模板资产的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ntplRoutes,ntplHttp} from '../../shared/contracts/ntpl-routes.generated.ts';
export const manifest=definePlugin({id:'ntpl-assets',name:"模板资产",description:"本地 PNG/JPEG、尺寸、替代文本与许可",category:'development',experimental:true,requires:[pin('ntpl-spaces')],systemDependencies:['notificationRenderCompute'],services:['ntplAssets'],contributes:{http:ntplHttp('assets'),routes:ntplRoutes('assets')}});
