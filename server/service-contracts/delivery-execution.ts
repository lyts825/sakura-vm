/** 交付执行插件的公共领域端口。 */
import type { DeliveryScope, DeliveryCandidate } from '../../shared/contracts/delivery-common.ts';
import type {
  DeliveryRun,
  DeliveryRunRequest,
  DeliveryPreview,
} from '../../shared/contracts/delivery-execution.ts';
export interface DeliveryRunnersV1 {
  list(scope: DeliveryScope): Promise<DeliveryRun[]>;
  get(scope: DeliveryScope, id: string): Promise<DeliveryRun>;
  start(scope: DeliveryScope, input: DeliveryRunRequest): Promise<DeliveryRun>;
  cancel(scope: DeliveryScope, id: string): Promise<DeliveryRun>;
  recover(scope: DeliveryScope, id: string): Promise<DeliveryRun>;
}
export interface DeliveryPreviewsV1 {
  list(scope: DeliveryScope): Promise<DeliveryPreview[]>;
  get(scope: DeliveryScope, id: string): Promise<DeliveryPreview>;
  start(
    scope: DeliveryScope,
    input: { candidate: DeliveryCandidate; lifetimeMinutes: number; reviewed: true },
  ): Promise<DeliveryPreview>;
  health(scope: DeliveryScope, id: string): Promise<DeliveryPreview>;
  stop(scope: DeliveryScope, id: string): Promise<DeliveryPreview>;
  recover(scope: DeliveryScope, id: string): Promise<DeliveryPreview>;
}
