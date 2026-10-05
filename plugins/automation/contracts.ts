import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type SuiteView = OperationResponse<'automation.legacy.get.vms.vmId.advanced'>;
export type Schedule = SuiteView['settings']['schedule'];
export type AlertConfig = SuiteView['settings']['alerts'];
