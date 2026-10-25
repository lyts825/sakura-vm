/** 仅转发到两个固定、由原插件持有的动作服务；不接受通用服务名或方法名。 */
import { AppError } from '../shared/errors.ts';
import {
  delegatedInputSchema,
  delegatedTicketSchema,
  delegatedAcknowledgementReason,
  type DelegatedAdapter,
} from '../shared/contracts/delegated-actions.ts';
import type { DelegatedActionsV1, DelegatedActionProvider } from './service-contracts/delegated-actions.ts';

export type DelegatedProviderResolver = (adapter: DelegatedAdapter) => DelegatedActionProvider | undefined;
export class DelegatedActions implements DelegatedActionsV1 {
  constructor(private resolve: DelegatedProviderResolver) {}
  private provider(adapter: DelegatedAdapter) {
    const provider = this.resolve(adapter);
    if (!provider)
      throw new AppError('原动作提供者未运行，请启用对应插件', 503, 'DELEGATED_PROVIDER_UNAVAILABLE');
    return provider;
  }
  async providers() {
    return (['maintenance-cleanup', 'resilience-reconcile'] as const).map((adapter) => ({
      adapter,
      available: !!this.resolve(adapter),
    }));
  }
  preview(input: Parameters<DelegatedActionsV1['preview']>[0]) {
    const parsed = delegatedInputSchema.parse(input);
    return this.provider(parsed.adapter).preview(parsed);
  }
  dispatch(
    ticket: Parameters<DelegatedActionsV1['dispatch']>[0],
    commitIntent: Parameters<DelegatedActionsV1['dispatch']>[1],
    signal?: AbortSignal,
  ) {
    const parsed = delegatedTicketSchema.parse(ticket);
    return this.provider(parsed.adapter).dispatch(parsed, commitIntent, signal);
  }
  inspect(ticket: Parameters<DelegatedActionsV1['inspect']>[0]) {
    const parsed = delegatedTicketSchema.parse(ticket);
    return this.provider(parsed.adapter).inspect(parsed);
  }
  acknowledge(ticket: Parameters<DelegatedActionsV1['acknowledge']>[0], reason: string) {
    const parsed = delegatedTicketSchema.parse(ticket);
    return this.provider(parsed.adapter).acknowledge(parsed, delegatedAcknowledgementReason.parse(reason));
  }
}
