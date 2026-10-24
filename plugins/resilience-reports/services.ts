/** 独立公共服务引用。 Independent public service reference. */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const service = serviceRef(
  'resilience-reports',
  'resilienceReports',
  serviceContracts.ResilienceReports,
);
