/** 独立领域公共引用。 Independent domain service reference. */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  actions: serviceRef('integration-runners', 'integrationActions', serviceContracts.IntegrationActions),
  runners: serviceRef('integration-runners', 'integrationRunners', serviceContracts.IntegrationRunners),
};
