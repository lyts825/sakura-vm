/** 系统交接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dsysRoutes,dsysHttp} from '../../shared/contracts/dsys-routes.generated.ts';
export const manifest=definePlugin({id:'dsys-exchange',name:"系统交接",description:"设计源、编译产物及许可封套",category:'development',experimental:true,requires:[pin('dsys-spaces'),pin('dsys-tokens'),pin('dsys-themes'),pin('dsys-typography'),pin('dsys-icons'),pin('dsys-components'),pin('dsys-states'),pin('dsys-layouts'),pin('dsys-checks'),pin('dsys-builds'),pin('dsys-reviews')],services:['dsysExchange'],contributes:{http:dsysHttp('exchange'),routes:dsysRoutes('exchange')}});
