/** 迟到策略的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {temporaldeskRoutes,temporaldeskHttp} from '../../shared/contracts/temporaldesk-routes.generated.ts';
export const manifest=definePlugin({id:'temporaldesk-latepolicy',name:"迟到策略",description:"固定水位序列、迟到阈值和更正办法",category:'development',experimental:true,requires:[pin('temporaldesk-spaces'),pin('temporaldesk-semantics'),pin('temporaldesk-windows')],systemDependencies:['temporalSeriesCompute'],services:['temporaldeskLatepolicy'],contributes:{http:temporaldeskHttp('latepolicy'),routes:temporaldeskRoutes('latepolicy')}});
