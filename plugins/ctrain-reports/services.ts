/** 训练报告的独立版本服务引用。 */
import {serviceRef} from '../../server/service-ref.ts';
import {serviceContracts} from '../../server/service-contracts.ts';
export const services={domain:serviceRef('ctrain-reports','ctrainReports',serviceContracts.CtrainReports)};
