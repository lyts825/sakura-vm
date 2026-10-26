/** 组件规格的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dsysRoutes,dsysHttp} from '../../shared/contracts/dsys-routes.generated.ts';
export const manifest=definePlugin({id:'dsys-components',name:"组件规格",description:"固定组件树、属性、插槽和变量引用",category:'development',experimental:true,requires:[pin('dsys-spaces'),pin('dsys-tokens'),pin('dsys-themes'),pin('dsys-typography'),pin('dsys-icons')],systemDependencies:['designSystemCompile'],services:['dsysComponents'],contributes:{http:dsysHttp('components'),routes:dsysRoutes('components')}});
