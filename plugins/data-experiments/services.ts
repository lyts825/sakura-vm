/** 独立版本的数据服务引用。 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  experiments: serviceRef('data-experiments', 'dataExperiments', serviceContracts.DataExperiments),
};
