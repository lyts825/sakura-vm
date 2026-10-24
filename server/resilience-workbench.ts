/** 工作台聚合公共服务，只读刷新不会自动运行任何步骤。
 * Workbench aggregates public services; refreshing never starts an execution. */
import type {
  ResilienceWorkbenchV1,
  ResilienceTargetsV1,
  ResilienceFixturesV1,
  ResilienceGuardV1,
  ResilienceRunsV1,
  ResilienceReportsV1,
  ResilienceScenariosV1,
} from './service-contracts/resilience-lab.ts';
import type { ResilienceScope } from '../shared/contracts/resilience-lab.ts';
import type { ResilienceAuthorize } from './resilience-store.ts';
export class ResilienceWorkbench implements ResilienceWorkbenchV1 {
  constructor(
    private targets: ResilienceTargetsV1,
    private fixtures: ResilienceFixturesV1,
    private guard: ResilienceGuardV1,
    private runs: ResilienceRunsV1,
    private reports: ResilienceReportsV1,
    private scenarios: ResilienceScenariosV1,
    private authorize: ResilienceAuthorize,
  ) {}
  async view(scope: ResilienceScope) {
    await this.authorize(scope);
    const [templates, capabilities, targets, replicas, runs, reports] = await Promise.all([
      this.scenarios.templates(scope),
      this.guard.view(scope),
      this.targets.view(scope),
      this.fixtures.view(scope),
      this.runs.view(scope),
      this.reports.view(scope),
    ]);
    return { templates, capabilities, targets, replicas, runs, reports };
  }
}
