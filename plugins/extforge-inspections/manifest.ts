/** 模块检查的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {extforgeRoutes,extforgeHttp} from '../../shared/contracts/extforge-routes.generated.ts';
export const manifest=definePlugin({id:'extforge-inspections',name:"模块检查",description:"导入、导出、内存、函数表及大小判断",category:'development',experimental:true,requires:[pin('extforge-spaces'),pin('extforge-builds')],systemDependencies:['extensionTrialRuntime'],services:['extforgeInspections'],contributes:{http:extforgeHttp('inspections'),routes:extforgeRoutes('inspections')}});
