/** 结果检查的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dextractRoutes,dextractHttp} from '../../shared/contracts/dextract-routes.generated.ts';
export const manifest=definePlugin({id:'dextract-checks',name:"结果检查",description:"缺项、类型、总和约束与重复候选发现",category:'development',experimental:true,requires:[pin('dextract-spaces'),pin('dextract-tables'),pin('dextract-schemas'),pin('dextract-fields')],systemDependencies:['documentExtractionSessions'],services:['dextractChecks'],contributes:{http:dextractHttp('checks'),routes:dextractRoutes('checks')}});
