/** 排版规格的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dsysRoutes,dsysHttp} from '../../shared/contracts/dsys-routes.generated.ts';
export const manifest=definePlugin({id:'dsys-typography',name:"排版规格",description:"字体档案、字阶、行距与回退约定",category:'development',experimental:true,requires:[pin('dsys-spaces'),pin('dsys-tokens'),pin('dsys-themes')],systemDependencies:['designSystemCompile'],services:['dsysTypography'],contributes:{http:dsysHttp('typography'),routes:dsysRoutes('typography')}});
