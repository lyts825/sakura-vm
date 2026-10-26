/** 方案交接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {csolveRoutes,csolveHttp} from '../../shared/contracts/csolve-routes.generated.ts';
export const manifest=definePlugin({id:'csolve-exchange',name:"方案交接",description:"模型及证据封套、隔离映射与核验",category:'development',experimental:true,requires:[pin('csolve-spaces'),pin('csolve-variables'),pin('csolve-domains'),pin('csolve-constraints'),pin('csolve-objectives'),pin('csolve-scenarios'),pin('csolve-runs'),pin('csolve-solutions'),pin('csolve-validation'),pin('csolve-conflicts'),pin('csolve-sensitivity'),pin('csolve-decisions')],services:['csolveExchange'],contributes:{http:csolveHttp('exchange'),routes:csolveRoutes('exchange')}});
