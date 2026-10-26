/** 沙箱试运行的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {extforgeRoutes,extforgeHttp} from '../../shared/contracts/extforge-routes.generated.ts';
export const manifest=definePlugin({id:'extforge-trials',name:"沙箱试运行",description:"固定产物的原调用、输出和清理回执",category:'development',experimental:true,requires:[pin('extforge-spaces'),pin('extforge-builds'),pin('extforge-inspections'),pin('extforge-cases')],systemDependencies:['extensionTrialRuntime'],services:['extforgeTrials'],contributes:{http:extforgeHttp('trials'),routes:extforgeRoutes('trials')}});
