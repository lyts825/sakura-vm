/** 十个独立服务；编排者只持有领域引用，不取得 VM 所有权。
 * Ten independent services; orchestration receives domain references, never VM ownership. */
import type { z } from 'zod';
import type { ImageAsset, ImageUpload } from '../../shared/contracts/image-assets.ts';
import type {
  DrillCapability,
  DrillDelegation,
  DrillEvidence,
  DrillToken,
} from '../../shared/contracts/drill-supervision.ts';
import type {
  ResilienceScope as Scope,
  ResilienceRef as Ref,
  ResilienceTarget as Target,
  ResilienceReplica as Replica,
  ResilienceTemplate as Template,
  ResilienceScenario as Scenario,
  ResiliencePlan as Plan,
  ResilienceSegment as Segment,
  ResilienceRun as Run,
  ResilienceReport as Report,
  ResilienceBundle as Bundle,
  ResilienceImport as Import,
  ResilienceCleanup as Cleanup,
  ResilienceRecoveryPlan as RecoveryPlan,
  resilienceTargetInputSchema,
  resilienceScenarioInputSchema,
} from '../../shared/contracts/resilience-lab.ts';
export interface ResilienceTargetsV1 {
  view(scope: Scope): Promise<Target[]>;
  register(scope: Scope, input: z.input<typeof resilienceTargetInputSchema>): Promise<Target>;
  get(scope: Scope, ref: Ref): Promise<Target>;
}
export interface ResilienceFixturesV1 {
  view(scope: Scope): Promise<Replica[]>;
  sources(scope: Scope): Promise<ImageAsset[]>;
  prepareBuiltin(
    scope: Scope,
    distro: ImageAsset['distro'],
    architecture: ImageAsset['architecture'],
  ): Promise<ImageAsset>;
  beginImport(
    scope: Scope,
    input: Pick<ImageUpload, 'digest' | 'bytes' | 'distro' | 'architecture' | 'source'>,
  ): Promise<ImageUpload>;
  appendImport(scope: Scope, id: string, offset: number, data: string): Promise<ImageUpload>;
  finishImport(scope: Scope, id: string): Promise<ImageAsset>;
  prepare(scope: Scope, target: Ref, runId: string): Promise<Replica>;
  get(scope: Scope, id: string): Promise<Replica>;
  authorizeDrill(
    scope: Scope,
    id: string,
    input: Omit<DrillDelegation, 'replica' | 'identity'>,
  ): Promise<DrillToken>;
  checkpoint(scope: Scope, id: string): Promise<Replica>;
  restore(scope: Scope, id: string, runId: string, confirmedIds: string[]): Promise<Replica>;
  cleanupPreview(scope: Scope, id: string): Promise<Cleanup>;
  cleanup(scope: Scope, plan: Cleanup): Promise<Replica>;
  retainInput(scope: Scope, target: Ref, reference: string): Promise<void>;
  releaseInput(scope: Scope, target: Ref, reference: string): Promise<void>;
  openInputRead(scope: Scope, target: Ref): Promise<{ id: string; digest: string; data: string }>;
  closeInputRead(scope: Scope, id: string): Promise<void>;
}
export interface ResilienceGuardV1 {
  view(scope: Scope): Promise<DrillCapability>;
  arm(scope: Scope, plan: Plan, replica: Replica, runId: string): Promise<void>;
  ticket(scope: Scope, runId: string, stepId: number): Promise<DrillToken>;
  withdraw(scope: Scope, runId: string): Promise<DrillEvidence>;
  contain(scope: Scope, runId: string): Promise<DrillEvidence>;
  reconcile(scope: Scope, runId: string): Promise<DrillEvidence>;
  release(scope: Scope, runId: string): Promise<DrillEvidence>;
  binding(scope: Scope, runId: string): Promise<{ plan: Plan; replica: Replica }>;
  handoff(scope: Scope, runId: string, replica: Replica): Promise<void>;
}
export interface ResilienceFaultsV1 {
  catalogue(scope: Scope): Promise<Template[]>;
  inject(scope: Scope, runId: string, idempotencyKey: string): Promise<DrillEvidence>;
  observe(scope: Scope, runId: string): Promise<DrillEvidence>;
}
export interface ResilienceProbesV1 {
  view(scope: Scope, runId: string): Promise<Segment[]>;
  collect(
    scope: Scope,
    runId: string,
    phase: Segment['phase'],
    scenario: Scenario,
    signal: AbortSignal,
  ): Promise<Segment>;
}
export interface ResilienceRecoveryV1 {
  preview(scope: Scope, runId: string, strategy: RecoveryPlan['strategy']): Promise<RecoveryPlan>;
  apply(scope: Scope, id: string, digest: string): Promise<DrillEvidence>;
}
export interface ResilienceScenariosV1 {
  view(scope: Scope): Promise<Scenario[]>;
  templates(scope: Scope): Promise<Template[]>;
  save(scope: Scope, input: z.input<typeof resilienceScenarioInputSchema>): Promise<Scenario>;
  get(scope: Scope, ref: Ref): Promise<Scenario>;
}
export interface ResilienceRunsV1 {
  view(scope: Scope): Promise<Run[]>;
  get(scope: Scope, id: string): Promise<Run>;
  preview(scope: Scope, scenario: Ref): Promise<Plan>;
  approve(scope: Scope, id: string, digest: string): Promise<Plan>;
  start(scope: Scope, id: string): Promise<Run>;
  cancel(scope: Scope, id: string): Promise<Run>;
  reconcile(scope: Scope, id: string): Promise<Run>;
}
export interface ResilienceReportsV1 {
  imports(scope: Scope): Promise<Omit<Import, 'report'>[]>;
  discardImport(scope: Scope, id: string): Promise<{ id: string; discarded: true }>;
  view(scope: Scope): Promise<Report[]>;
  retention(scope: Scope): Promise<{ id: string; pinned: boolean; expiresAt: string; archiving: boolean }[]>;
  pin(scope: Scope, id: string, pinned: boolean): Promise<{ id: string; pinned: boolean }>;
  archive(scope: Scope, id: string): Promise<{ id: string; archived: true }>;
  seal(scope: Scope, runId: string): Promise<Report>;
  export(scope: Scope, id: string): Promise<Bundle>;
  import(scope: Scope, bundle: Bundle): Promise<Import>;
  accept(scope: Scope, id: string): Promise<Import>;
  compare(
    scope: Scope,
    left: string,
    right: string,
  ): Promise<{ compatible: boolean; differences: string[]; left: Report; right: Report }>;
}
export interface ResilienceWorkbenchV1 {
  view(scope: Scope): Promise<{
    templates: Template[];
    capabilities: DrillCapability;
    targets: Target[];
    replicas: Replica[];
    runs: Run[];
    reports: Report[];
  }>;
}
