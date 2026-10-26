/** 开发报告的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {extforgeRoutes,extforgeHttp} from '../../shared/contracts/extforge-routes.generated.ts';
export const manifest=definePlugin({id:'extforge-reports',name:"开发报告",description:"构建环境、检查、试运行和审阅证据",category:'development',experimental:true,requires:[pin('extforge-spaces'),pin('extforge-builds'),pin('extforge-inspections'),pin('extforge-trials'),pin('extforge-signatures'),pin('extforge-bundles'),pin('extforge-reviews')],systemDependencies:['extensionTrialRuntime'],services:['extforgeReports'],contributes:{http:extforgeHttp('reports'),routes:extforgeRoutes('reports')}});
