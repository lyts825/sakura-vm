/** 地图样式的独立版本服务引用。 */
import {serviceRef} from '../../server/service-ref.ts';
import {serviceContracts} from '../../server/service-contracts.ts';
export const services={domain:serviceRef('geodesk-styles','geodeskStyles',serviceContracts.GeodeskStyles)};
