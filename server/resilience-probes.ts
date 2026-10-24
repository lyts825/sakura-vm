/** 探针保存逐请求证据；空样本、重复和中断不能报告通过。
 * Probes persist request evidence; empty, duplicate or interrupted samples cannot pass. */
import { z } from 'zod';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { DrillSupervisionV1 } from './service-contracts/drill-supervision.ts';
import type { ResilienceProbesV1, ResilienceGuardV1 } from './service-contracts/resilience-lab.ts';
import {
  resilienceSegmentSchema,
  type ResilienceScope as Scope,
  type ResilienceScenario as Scenario,
  type ResilienceSegment as Segment,
} from '../shared/contracts/resilience-lab.ts';
import {
  ResilienceStore,
  resilienceId,
  resilienceNow,
  resilienceConsumer,
  sameScope,
  type ResilienceAuthorize,
} from './resilience-store.ts';
const schema = z.object({ rows: z.array(resilienceSegmentSchema).max(240) }).strict();
export class ResilienceProbes implements ResilienceProbesV1 {
  private store: ResilienceStore<z.infer<typeof schema>>;
  constructor(
    metadata: PluginMetadata<unknown>,
    private guard: ResilienceGuardV1,
    private core: DrillSupervisionV1,
    authorize: ResilienceAuthorize,
  ) {
    this.store = new ResilienceStore(metadata, schema, () => ({ rows: [] }), authorize);
  }
  async view(scope: Scope, runId: string) {
    return (await this.store.read(scope)).rows.filter((x) => sameScope(x.scope, scope) && x.runId === runId);
  }
  async collect(
    scope: Scope,
    runId: string,
    phase: Segment['phase'],
    scenario: Scenario,
    signal: AbortSignal,
  ) {
    resilienceConsumer('resilience-runs');
    await this.store.authorize(scope);
    const ticket = await this.guard.ticket(scope, runId, { baseline: 0, fault: 2, recovery: 4 }[phase]);
    const duration = phase === 'fault' ? Math.max(1, scenario.parameters.durationSeconds - 6) : 60,
      id = resilienceId(),
      started = performance.now(),
      startedAt = resilienceNow();
    const samples: Segment['samples'] = [],
      missing: string[] = [];
    try {
      while (performance.now() - started < duration * 1000) {
        signal.throwIfAborted();
        const sample = await this.core.probe(ticket, 'probe-' + id + '-' + samples.length);
        samples.push(sample);
        if (samples.length >= 20000) {
          missing.push('样本预算已用尽');
          break;
        }
        await delay(1000, undefined, { signal });
      }
    } catch (e) {
      missing.push(signal.aborted ? '采样已取消' : String(e).slice(0, 500));
    }
    const sorted = samples
        .filter((s) => s.ok)
        .map((s) => s.elapsedMs)
        .sort((a, b) => a - b),
      count = samples.length,
      errors = samples.filter((s) => !s.ok).length,
      duplicates = count - new Set(samples.map((s) => s.requestId)).size,
      p95Ms = sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
      durationMs = performance.now() - started;
    const segment = resilienceSegmentSchema.parse({
      id,
      runId,
      scope,
      phase,
      startedAt,
      endedAt: resilienceNow(),
      durationMs,
      samples,
      count,
      errors,
      duplicates,
      p95Ms,
      algorithm: 'nearest-rank-v1',
      passed:
        missing.length === 0 &&
        duplicates === 0 &&
        count >= scenario.minimumSamples &&
        errors <= scenario.maxErrors &&
        p95Ms !== null &&
        p95Ms <= scenario.maxP95Ms &&
        (phase === 'fault' || durationMs >= 60000),
      missing,
    });
    await this.store.mutate(scope, (s) => {
      s.rows.push(segment);
    });
    if (signal.aborted) signal.throwIfAborted();
    return segment;
  }
}
