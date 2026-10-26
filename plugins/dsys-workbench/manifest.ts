/** 系统工作台的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dsysRoutes,dsysHttp} from '../../shared/contracts/dsys-routes.generated.ts';
export const manifest=definePlugin({id:'dsys-workbench',name:"系统工作台",description:"变量编辑、主题预览、状态矩阵与版本导航",category:'development',experimental:true,requires:[pin('dsys-spaces'),pin('dsys-tokens'),pin('dsys-themes'),pin('dsys-typography'),pin('dsys-icons'),pin('dsys-components'),pin('dsys-states'),pin('dsys-layouts'),pin('dsys-checks'),pin('dsys-builds'),pin('dsys-reviews'),pin('dsys-exchange')],systemDependencies:['designSystemCompile'],services:['dsysWorkbench'],contributes:{pages:['design-system-studio'],http:dsysHttp('workbench'),routes:dsysRoutes('workbench')}});
