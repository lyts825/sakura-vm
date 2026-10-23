/** 报告、门禁和交接服务的公开契约。 Public report, gate and handoff contracts. */
import type {
  DeliveryScope,
  DeliveryCandidate,
  DeliveryReportFormat,
  DeliveryManifest,
} from '../../shared/contracts/delivery-common.ts';
import type {
  DeliveryEvidence,
  DeliveryPolicy,
  DeliveryDecision,
  DeliveryPolicyInput,
  DeliveryEvaluateInput,
  DeliveryGateView,
  DeliveryReleaseView,
  DeliveryRelease,
  DeliveryChannel,
  DeliveryTrustKey,
  DeliveryImport,
} from '../../shared/contracts/delivery-quality.ts';
export interface DeliveryReportsV1 {
  /** 请求 scope 的报告历史；返回证据数组，无写入。 Request report history for scope; return evidence without writes. */
  view(scope: DeliveryScope): Promise<DeliveryEvidence[]>;
  /** 请求 scope/id 的单条证据；不存在时应拒绝。 Request evidence by scope/id; absence must reject. */
  get(scope: DeliveryScope, id: string): Promise<DeliveryEvidence>;
  /** 提交 input 原始报告引用，返回追加的本机证据；实现须绑定候选和运行并保留原始制品。 Submit input raw-report references and return appended local evidence; providers must bind candidate/run and retain raw artifacts. */
  ingest(
    scope: DeliveryScope,
    input: {
      candidate: DeliveryCandidate;
      runId: string;
      manifestId: string;
      path: string;
      format: DeliveryReportFormat;
    },
  ): Promise<DeliveryEvidence>;
  /** 比较 scope 内 leftId/rightId 的基准，返回可比性和中位数变化，无写入。 Compare scoped benchmarks leftId/rightId and return comparability/median change without writes. */
  compare(
    scope: DeliveryScope,
    leftId: string,
    rightId: string,
  ): Promise<{
    comparable: boolean;
    reason: string;
    changePercent: number | null;
  }>;
}
export interface DeliveryGatesV1 {
  /** 请求 scope 的规则和判定历史，无写入。 Request policy and decision history for scope without writes. */
  view(scope: DeliveryScope): Promise<DeliveryGateView>;
  /** 按 input.expectedRevision 追加规则，返回新版本；冲突应拒绝。 Append a policy at input.expectedRevision and return it; conflicts must reject. */
  savePolicy(scope: DeliveryScope, input: DeliveryPolicyInput): Promise<DeliveryPolicy>;
  /** 以 input 指定候选、规则和证据创建判定；实现须独立核对本机引用，不接受客户端通过声明。 Create a decision from input candidate/policy/evidence; providers must verify local references rather than client pass claims. */
  evaluate(scope: DeliveryScope, input: DeliveryEvaluateInput): Promise<DeliveryDecision>;
  /** 请求仍适用于 candidateDigest 的 decisionId 及规则；过期、规则变化或证据不符应拒绝，无写入。 Request decisionId/policy still applicable to candidateDigest; expiry, policy or evidence changes must reject without writes. */
  assertCurrent(
    scope: DeliveryScope,
    decisionId: string,
    candidateDigest: string,
  ): Promise<{
    decision: DeliveryDecision;
    policy: DeliveryPolicy;
  }>;
}
export interface DeliveryReleasesV1 {
  /** 请求 scope 的版本、候选、隔离和信任视图，无写入。 Request releases, candidates, quarantine and trust for scope without writes. */
  view(scope: DeliveryScope): Promise<DeliveryReleaseView>;
  /** 请求本机或已接受的 scope/id 候选；隔离记录不得返回为可执行候选。 Request local or accepted scope/id candidate; quarantine must not be returned as executable authority. */
  candidate(scope: DeliveryScope, id: string): Promise<DeliveryCandidate>;
  /** 由 input 服务端引用创建并返回候选；实现负责保存和绑定精确摘要的执行引用。 Create/return a candidate from input server-side references; providers own persistence and exact-digest execution references. */
  createCandidate(
    scope: DeliveryScope,
    input: {
      inputId: string;
      runId: string;
      manifestId: string;
    },
  ): Promise<DeliveryCandidate>;
  /** 以 input 绑定候选、当前判定和版本，返回登记并保留制品；版本核心冲突应拒绝。 Bind input candidate/current decision/version, return registration and retain artifacts; conflicting version cores must reject. */
  register(
    scope: DeliveryScope,
    input: {
      candidateId: string;
      decisionId: string;
      namespace: string;
      version: string;
      notes: string;
    },
  ): Promise<DeliveryRelease>;
  /** 按 input.expectedRevision 改写通道及历史，返回新状态；晋级须复核当前证据。 Change channel/history at input.expectedRevision and return new state; promotion requires current evidence checks. */
  channel(
    scope: DeliveryScope,
    input: {
      name: 'candidate' | 'stable';
      expectedRevision: number;
      releaseId: string | null;
    },
  ): Promise<DeliveryChannel>;
  /** 按 input 撤回或归档版本并保存原因，返回版本；保留制品引用。 Withdraw/archive a release using input and persist its reason; return the release while retaining artifact references. */
  changeStatus(
    scope: DeliveryScope,
    input: {
      id: string;
      status: 'withdrawn' | 'archived';
      reason: string;
    },
  ): Promise<DeliveryRelease>;
  /** 按 input 信任版本登记或撤销交付公钥，返回修订及公钥；已有标识不得替换。 Register/revoke a delivery key at input trust revision and return revision/keys; existing identities must not be replaced. */
  trust(
    scope: DeliveryScope,
    input: {
      expectedRevision: number;
      id: string;
      publisher?: string;
      publicKey?: string;
      revoke?: boolean;
    },
  ): Promise<{
    revision: number;
    keys: DeliveryTrustKey[];
  }>;
  /** 导出 input 版本及可选源码/签名，返回封存 ZIP 清单和独立包/核心摘要；会写入制品。 Export input release with optional source/signature, returning a sealed ZIP manifest and separate package/core digests; writes artifacts. */
  export(
    scope: DeliveryScope,
    input: {
      id: string;
      includeSource: boolean;
      signingKeyRef?: string;
    },
  ): Promise<{
    manifest: DeliveryManifest;
    packageDigest: string;
    releaseCoreDigest: string;
    signed: boolean;
  }>;
  /** 校验 input.manifestId 并返回隔离记录，使用本机新标识；导入本身不得授予执行许可。 Validate input.manifestId and return quarantine with new local IDs; import alone must not authorize execution. */
  importPackage(
    scope: DeliveryScope,
    input: {
      manifestId: string;
    },
  ): Promise<DeliveryImport>;
  /** 依据 input 审阅、命名空间和信任接受导入，返回记录并授予精确候选引用；失败可重试。 Accept import based on input review/namespace/trust, return its record and grant an exact candidate reference; failures are retryable. */
  acceptImport(
    scope: DeliveryScope,
    input: {
      id: string;
      namespace: string;
      allowUntrusted: boolean;
      reviewed: true;
    },
  ): Promise<DeliveryImport>;
}
