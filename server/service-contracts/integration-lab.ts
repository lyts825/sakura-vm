/** 独立集成领域公共端口；消费者只能取得声明的服务。 Independent integration domain ports. */
import type * as I from '../../shared/contracts/integration-lab.ts';
import type {
  IntegrationBundle,
  IntegrationImport,
  IntegrationUpload,
} from '../../shared/contracts/integration-exchange.ts';
import type { ImageAsset, ImageUpload } from '../../shared/contracts/image-assets.ts';
export interface IntegrationDefinitionsV1<T> {
  list(scope: I.IntegrationScope): Promise<I.IntegrationRevision<T>[]>;
  get(scope: I.IntegrationScope, ref: I.IntegrationRef): Promise<I.IntegrationRevision<T>>;
  save(scope: I.IntegrationScope, input: I.IntegrationSave<T>): Promise<I.IntegrationRevision<T>>;
  seal(scope: I.IntegrationScope, ref: I.IntegrationRef): Promise<I.IntegrationRevision<T>>;
  archive(scope: I.IntegrationScope, ref: I.IntegrationRef): Promise<I.IntegrationRevision<T>>;
}
export interface IntegrationSpecsV1 extends IntegrationDefinitionsV1<I.HttpContract> {
  createWorkspace(input: { name: string; importing?: boolean }): Promise<I.IntegrationWorkspace>;
  workspaces(): Promise<I.IntegrationWorkspace[]>;
  assertWorkspace(
    scope: I.IntegrationScope & { expectedRevision?: string; allowImporting?: boolean },
  ): Promise<{ workspace: I.IntegrationWorkspace; consumer: string; requestId: string }>;
  publishWorkspace(scope: I.IntegrationScope, expectedRevision: string): Promise<I.IntegrationWorkspace>;
  reserveCapacity(
    scope: I.IntegrationScope,
    input: { objects: number; revisions: number; bytes: number; metadataBytes: number; controlBytes: number },
  ): Promise<I.IntegrationCapacity>;
  commitCapacity(
    scope: I.IntegrationScope,
    token: string,
    actual?: {
      objects: number;
      revisions: number;
      bytes: number;
      metadataBytes: number;
      controlBytes: number;
    },
  ): Promise<I.IntegrationCapacity>;
  releaseCapacity(scope: I.IntegrationScope, token: string): Promise<I.IntegrationCapacity>;
  reference(
    scope: I.IntegrationScope,
    ref: I.IntegrationRef,
    owner: string,
    release?: boolean,
  ): Promise<void>;
  references(scope: I.IntegrationScope, ref: I.IntegrationRef): Promise<string[]>;
  compare(
    scope: I.IntegrationScope,
    before: I.IntegrationRef,
    after: I.IntegrationRef,
  ): Promise<I.IntegrationComparison>;
  comparisons(scope: I.IntegrationScope): Promise<I.IntegrationComparison[]>;
}
export interface IntegrationEnvironmentsV1 extends IntegrationDefinitionsV1<I.IntegrationEnvironment> {
  applicationTargets(
    scope: I.IntegrationScope,
  ): Promise<{
    available: boolean;
    targets: Array<{ appId: string; name: string; revision: number; identityDigest: string }>;
  }>;
  versions(scope: I.IntegrationScope, ref: I.IntegrationRef): Promise<Record<string, string>>;
  resolve(
    scope: I.IntegrationScope,
    ref: I.IntegrationRef,
    versions: Record<string, string>,
  ): Promise<Record<string, string>>;
  revoke(scope: I.IntegrationScope, ref: I.IntegrationRef): Promise<void>;
}
export interface IntegrationFixturesV1 extends IntegrationDefinitionsV1<I.IntegrationFixture> {
  importData(
    scope: I.IntegrationScope,
    input: { name: string; format: 'json' | 'csv'; text: string; redact: string[] },
  ): Promise<I.IntegrationRevision<I.IntegrationFixture>>;
  generate(
    scope: I.IntegrationScope,
    input: { name: string; seed: number; rows: number },
  ): Promise<I.IntegrationRevision<I.IntegrationFixture>>;
}
export interface IntegrationMocksV1 extends IntegrationDefinitionsV1<I.IntegrationMock> {}
export interface IntegrationScenariosV1 extends IntegrationDefinitionsV1<I.IntegrationScenario> {
  compile(scope: I.IntegrationScope, ref: I.IntegrationRef): Promise<{ digest: string; order: string[] }>;
}
export interface IntegrationAssertionsV1 extends IntegrationDefinitionsV1<I.IntegrationAssertion> {
  evaluate(
    scope: I.IntegrationScope,
    runId: string,
    ref: I.IntegrationRef,
    evidence: I.IntegrationEvidence[],
  ): Promise<I.IntegrationEvaluation>;
  evaluations(scope: I.IntegrationScope, runId: string): Promise<I.IntegrationEvaluation[]>;
}
export interface IntegrationRunnersV1 {
  availableImages(scope: I.IntegrationScope): Promise<ImageAsset[]>;
  beginImage(
    scope: I.IntegrationScope,
    input: Pick<ImageUpload, 'digest' | 'bytes' | 'distro' | 'architecture' | 'source'>,
  ): Promise<ImageUpload>;
  appendImage(scope: I.IntegrationScope, id: string, offset: number, data: string): Promise<ImageUpload>;
  finishImage(scope: I.IntegrationScope, id: string): Promise<ImageAsset>;
  imageUploads(scope: I.IntegrationScope): Promise<ImageUpload[]>;
  discardImage(scope: I.IntegrationScope, id: string): Promise<void>;
  list(scope: I.IntegrationScope): Promise<I.IntegrationRun[]>;
  plans(scope: I.IntegrationScope): Promise<I.IntegrationRunPlan[]>;
  preview(scope: I.IntegrationScope, input: I.IntegrationRunInput): Promise<I.IntegrationRunPlan>;
  apply(
    scope: I.IntegrationScope,
    input: { planId: string; digest: string; approveWrites: boolean },
  ): Promise<I.IntegrationRun>;
  inspect(scope: I.IntegrationScope, id: string): Promise<I.IntegrationRun>;
  cancel(scope: I.IntegrationScope, id: string): Promise<I.IntegrationRun>;
  recover(scope: I.IntegrationScope, id: string): Promise<I.IntegrationRun>;
  verifyEffect(
    scope: I.IntegrationScope,
    id: string,
    evidenceDigest: string,
    conclusion: 'confirmed-applied' | 'confirmed-not-applied' | 'unresolved',
  ): Promise<I.IntegrationRun>;
}
export interface IntegrationLoadV1 extends IntegrationDefinitionsV1<I.IntegrationLoadProfile> {
  preview(scope: I.IntegrationScope, ref: I.IntegrationRef): Promise<I.IntegrationRunPlan>;
  apply(
    scope: I.IntegrationScope,
    input: { planId: string; digest: string; approveWrites: boolean },
  ): Promise<I.IntegrationRun>;
}
export interface IntegrationReportsV1 {
  list(scope: I.IntegrationScope): Promise<I.IntegrationReport[]>;
  get(scope: I.IntegrationScope, id: string): Promise<I.IntegrationReport>;
  seal(scope: I.IntegrationScope, runId: string): Promise<I.IntegrationReport>;
  compare(
    scope: I.IntegrationScope,
    before: string,
    after: string,
  ): Promise<{
    comparable: boolean;
    reasons: string[];
    before: I.IntegrationReport;
    after: I.IntegrationReport;
  }>;
  cleanupPlan(scope: I.IntegrationScope): Promise<{ digest: string; ids: string[]; protected: string[] }>;
  cleanup(scope: I.IntegrationScope, digest: string): Promise<{ removed: number }>;
}
export interface IntegrationExchangeV1 {
  beginUpload(input: {
    name: string;
    bytes: number;
    digest: string;
    contentType: 'application/zip';
  }): Promise<IntegrationUpload>;
  appendUpload(id: string, offset: number, data: string): Promise<IntegrationUpload>;
  completeUpload(id: string): Promise<IntegrationImport>;
  uploads(): Promise<IntegrationUpload[]>;
  discardUpload(id: string): Promise<IntegrationUpload>;
  exportBundle(
    scope: I.IntegrationScope,
    input: {
      scenario: I.IntegrationRef;
      mock: I.IntegrationRef | null;
      assertions: I.IntegrationRef;
      reports: string[];
    },
  ): Promise<IntegrationBundle>;
  quarantine(input: { bundle: IntegrationBundle }): Promise<IntegrationImport>;
  imports(): Promise<IntegrationImport[]>;
  accept(id: string, digest: string): Promise<IntegrationImport>;
}
export interface IntegrationWorkbenchV1 {
  templates(): Promise<{ id: 'order-demo' | 'pagination' | 'contract-change'; name: string }[]>;
  create(input: { name: string; template: 'order-demo' | 'pagination' | 'contract-change' }): Promise<{
    workspace: I.IntegrationWorkspace;
    scenario: I.IntegrationRef | null;
    mock: I.IntegrationRef | null;
    assertions: I.IntegrationRef | null;
    comparison: I.IntegrationComparison | null;
  }>;
  view(
    scope: I.IntegrationScope,
  ): Promise<{ workspace: I.IntegrationWorkspace; runs: I.IntegrationRun[]; reports: I.IntegrationReport[] }>;
}
