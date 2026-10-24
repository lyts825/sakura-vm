/** 固定故障消费者，普通管理租约不能作为注入票据。
 * Fixed fault consumer; a management lease is never an injection ticket. */
import type { DrillSupervisionV1 } from './service-contracts/drill-supervision.ts';
import type { ResilienceFaultsV1, ResilienceGuardV1 } from './service-contracts/resilience-lab.ts';
import { resilienceTemplates, type ResilienceScope as Scope } from '../shared/contracts/resilience-lab.ts';
import { resilienceConsumer, type ResilienceAuthorize } from './resilience-store.ts';
export class ResilienceFaults implements ResilienceFaultsV1 {
  constructor(
    private guard: ResilienceGuardV1,
    private core: DrillSupervisionV1,
    private authorize: ResilienceAuthorize,
  ) {}
  async catalogue(scope: Scope) {
    await this.authorize(scope);
    return structuredClone(resilienceTemplates);
  }
  async inject(scope: Scope, runId: string, idempotencyKey: string) {
    resilienceConsumer('resilience-runs');
    await this.authorize(scope);
    return this.core.inject(await this.guard.ticket(scope, runId, 1), idempotencyKey);
  }
  async observe(scope: Scope, runId: string) {
    await this.authorize(scope);
    return this.core.observe(await this.guard.ticket(scope, runId, 1));
  }
}
