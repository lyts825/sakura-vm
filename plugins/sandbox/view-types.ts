import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type SandboxOverview = OperationResponse<'sandbox.list'>;
export type SandboxView = SandboxOverview['sandboxes'][number];
