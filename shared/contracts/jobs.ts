/**
 * 模块职责（中文）：异步任务的公开元数据、执行状态和更新消息，供任务聚合、事件与界面共同使用。
 * Module responsibility (English): asynchronous job metadata, state and updates.
 * 详细范围（中文）：公开入口包括 JobMeta, JobView, JobUpdate；职责覆盖异步任务元数据、状态和更新，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include JobMeta, JobView, JobUpdate. The scope covers asynchronous job metadata, state and updates. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { SandboxExecution } from '../sandbox.ts';

export type JobMeta = {
  title?: string;
  vmId?: string;
  action?: string;
  projectId?: string;
  execution?: SandboxExecution;
  /** Stable resource owner; defaults to the Jobs scope. */
  owner?: string;
  lane?: 'interactive' | 'background' | 'control';
  admissionTimeoutMs?: number;
};
export type JobView = JobMeta & {
  /** 发起任务的请求回执；不代表后台任务已完成。 / Request receipt, not proof of job completion. */
  correlationId?: string;
  id?: string;
  key?: string;
  scope?: string;
  status: 'running' | 'done' | 'error' | 'cancelled' | 'interrupted';
  /** Queued jobs remain status=running for existing consumers. */
  admission?: 'queued' | 'running' | 'cancelling' | 'cleanup-pending';
  queuedAt?: string;
  executionStartedAt?: string;
  resourceWait?: { resource: string; reason: string; since: string };
  resourceLeaseId?: string;
  cleanupLeaseId?: string;
  cleanupResolvedAt?: string;
  delegatedFrom?: string;
  log: string;
  error?: string;
  errorCode?: string;
  startedAt: string;
  finishedAt?: string;
  phase?: string;
  progress?: number;
  result?: { bytes: number; sha256: string };
  logPruned?: { at: string; bytes: number };
};
export type JobUpdate = /** 中文：声明任务阶段与可选数字进度的更新回调；用于反馈任务执行，不承诺完成或返回任务结果。 | English: Declare the callback updating job phase and optional numeric progress; it reports execution without promising completion or returning a job result. | 中文：输入：phase：签名所示 string 业务值；progress：任务的可选数字进度值 | English: Inputs: phase: the string domain value in the signature; progress: optional numeric job progress | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (phase: string, progress?: number) => void;
