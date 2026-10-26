/** 固定仓库的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {depsolveRoutes,depsolveHttp} from '../../shared/contracts/depsolve-routes.generated.ts';
export const manifest=definePlugin({id:'depsolve-catalogs',name:"固定仓库",description:"包版本、依赖边、平台标记和内容摘要材料",category:'development',experimental:true,requires:[pin('depsolve-spaces')],systemDependencies:['dependencyConstraintCompute'],services:['depsolveCatalogs'],contributes:{http:depsolveHttp('catalogs'),routes:depsolveRoutes('catalogs')}});
