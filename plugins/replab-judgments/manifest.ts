/** 性质判断的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {replabRoutes,replabHttp} from '../../shared/contracts/replab-routes.generated.ts';
export const manifest=definePlugin({id:'replab-judgments',name:"性质判断",description:"收敛、保留、顺序及反例的可重算判断",category:'development',experimental:true,requires:[pin('replab-spaces'),pin('replab-schemas'),pin('replab-scenarios'),pin('replab-runs'),pin('replab-conflicts')],systemDependencies:['replicaModelCompute'],services:['replabJudgments'],contributes:{http:replabHttp('judgments'),routes:replabRoutes('judgments')}});
