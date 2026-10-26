/** 候选比较的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ctrainRoutes,ctrainHttp} from '../../shared/contracts/ctrain-routes.generated.ts';
export const manifest=definePlugin({id:'ctrain-comparisons',name:"候选比较",description:"固定验证域排序、平局规则及差异",category:'development',experimental:true,requires:[pin('ctrain-spaces'),pin('ctrain-searches'),pin('ctrain-runs'),pin('ctrain-metrics')],systemDependencies:['classicalTrainingSessions'],services:['ctrainComparisons'],contributes:{http:ctrainHttp('comparisons'),routes:ctrainRoutes('comparisons')}});
