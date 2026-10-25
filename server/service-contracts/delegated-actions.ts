/** 提供者持有原票据；顶层回调由 broker 恢复实际消费者的权限。 */
import type {
  DelegatedAdapter,
  DelegatedInput,
  DelegatedTicket,
  DelegatedPlan,
  DelegatedReceipt,
  DelegatedIntent,
} from '../../shared/contracts/delegated-actions.ts';
export interface DelegatedActionProvider {
  preview(input: DelegatedInput): Promise<DelegatedPlan>;
  dispatch(
    ticket: DelegatedTicket,
    commitIntent: (plan: DelegatedPlan) => Promise<DelegatedIntent>,
    signal?: AbortSignal,
  ): Promise<DelegatedReceipt>;
  inspect(ticket: DelegatedTicket): Promise<DelegatedReceipt>;
}
export interface DelegatedActionsV1 extends DelegatedActionProvider {
  providers(): Promise<{ adapter: DelegatedAdapter; available: boolean }[]>;
}
export interface MaintenanceActionsV1 extends DelegatedActionProvider {}
export interface ResilienceActionsV1 extends DelegatedActionProvider {}
