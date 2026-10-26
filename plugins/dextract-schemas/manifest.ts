/** 字段约定的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dextractRoutes,dextractHttp} from '../../shared/contracts/dextract-routes.generated.ts';
export const manifest=definePlugin({id:'dextract-schemas',name:"字段约定",description:"字段名、类型、必填及有限提取规则",category:'development',experimental:true,requires:[pin('dextract-spaces')],systemDependencies:['documentExtractionSessions'],services:['dextractSchemas'],contributes:{http:dextractHttp('schemas'),routes:dextractRoutes('schemas')}});
