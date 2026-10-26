/** 候选搜索的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ctrainRoutes,ctrainHttp} from '../../shared/contracts/ctrain-routes.generated.ts';
export const manifest=definePlugin({id:'ctrain-searches',name:"候选搜索",description:"有界候选表、选择规则及预算分配",category:'development',experimental:true,requires:[pin('ctrain-spaces'),pin('ctrain-estimators'),pin('ctrain-partitions')],systemDependencies:['classicalTrainingSessions'],services:['ctrainSearches'],contributes:{http:ctrainHttp('searches'),routes:ctrainRoutes('searches')}});
