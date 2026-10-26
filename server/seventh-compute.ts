/** 固定领域算法的受管工作线程入口；调用方只能提交绑定包的声明动作。 */
import { computeRuntime } from './compute-runtime.ts';
import { suiteFail } from './suite-store.ts';
import { suiteJson, type SuiteJson } from '../shared/contracts/suite-common.ts';
import catalog from '../shared/seventh-catalog.json';
import type { SeventhComputePortV1 } from '../shared/contracts/seventh-common.ts';
import { hostRuntime } from './host-runtime/index.ts';
import { computeSeventhCreation, CREATION_NATIVE_ACTIONS } from './seventh-creation-compute.ts';
import { probeCreationNativeAssets,probeCreationNativeIdentity } from './seventh-creation-native.ts';
import {
  seventhNativeOptions,
  prepareNativeTask,
  getNativeTask,
  updateNativeTask,
  claimNativeTask,
  releaseNativeTask,
  nativeTicket,
  type NativeTask,
} from './seventh-native-capacity.ts';
import {
  prepareCreationSession,
  startCreationSession,
  readCreationSessionOutput,
  readCreationSessionRequest,
  reconcileCreationSession,
  eraseCreationSession,
  saveCreationSessionResult,
  loadCreationSessionResult,
  saveCreationSessionPayload,
  loadCreationSessionPayload,
} from './seventh-creation-session.ts';
import { digest } from './seventh-creation-common.ts';
import { storageRuntime } from './storage-runtime.ts';
import type { ResourceLease } from './host-runtime/index.ts';
import type { SuiteRecord } from '../shared/contracts/suite-common.ts';
import type { SeventhToolIdentity, SeventhNativeTaskTicket } from '../shared/contracts/seventh-common.ts';
import type { SuiteRef } from '../shared/contracts/suite-common.ts';
const nativeLeases = new Map<string, ResourceLease>();
const nativeError = (error: unknown) => ({
  code: String((error as { code?: string }).code ?? 'NATIVE_EXECUTION_FAILED'),
  message: String((error as Error).message ?? error).slice(0, 4096),
});
function sameTool(a: SeventhToolIdentity, b: SeventhToolIdentity) {
  return (
    a.manifestDigest === b.manifestDigest &&
    a.workerDigest === b.workerDigest &&
    a.helperDigest === b.helperDigest
  );
}
export class SeventhComputePort implements SeventhComputePortV1 {
  constructor(
    private readonly packId: string,
    private readonly owner: string,
  ) {}
  async actions(): Promise<string[]> {
    const pack = catalog.find((p) => p.id === this.packId) ?? suiteFail('SEVENTH_PACK');
    const module =
      pack.group === 'data'
        ? await import('./seventh-data-compute.ts')
        : pack.group === 'creation'
          ? await import('./seventh-creation-compute.ts')
          : await import('./seventh-engineering-compute.ts');
    const table = Reflect.get(
      module,
      pack.group === 'data'
        ? 'SEVENTH_DATA_ACTIONS'
        : pack.group === 'creation'
          ? 'SEVENTH_CREATION_ACTIONS'
          : 'SEVENTH_ENGINEERING_ACTIONS',
    ) as Record<string, string[]>;
    const life = await this.lifeModule();
    const lifecycle = Reflect.get(
      life,
      pack.group === 'data'
        ? 'SEVENTH_DATA_LIFECYCLE_ACTIONS'
        : pack.group === 'creation'
          ? 'SEVENTH_CREATION_LIFECYCLE_ACTIONS'
          : 'SEVENTH_ENGINEERING_LIFECYCLE_ACTIONS',
    ) as Record<string, string[]>;
    return [...new Set([...(table[this.packId] ?? []), ...(lifecycle[this.packId] ?? [])])];
  }
  private async lifeModule() {
    const group = catalog.find((p) => p.id === this.packId)!.group;
    return group === 'data'
      ? await import('./seventh-data-lifecycle.ts')
      : group === 'creation'
        ? await import('./seventh-creation-lifecycle.ts')
        : await import('./seventh-engineering-lifecycle.ts');
  }
  async lifecycle(action: string) {
    const group = catalog.find((p) => p.id === this.packId)!.group;
    const m = await this.lifeModule();
    const table = Reflect.get(
      m,
      group === 'data'
        ? 'SEVENTH_DATA_LIFECYCLE_ACTIONS'
        : group === 'creation'
          ? 'SEVENTH_CREATION_LIFECYCLE_ACTIONS'
          : 'SEVENTH_ENGINEERING_LIFECYCLE_ACTIONS',
    ) as Record<string, readonly string[]>;
    return !!table[this.packId]?.includes(action);
  }
  async toolIdentity(action: string, signal?: AbortSignal): Promise<SeventhToolIdentity | null> {
    if (!CREATION_NATIVE_ACTIONS[this.packId]?.includes(action)) return null;
    const lease = await this.nativeLease(this.packId + ':tool-identity', signal);
    try {
      const options = seventhNativeOptions(),
        asset = await probeCreationNativeAssets({ ...options, signal, owner: this.owner });
      return {
        manifestDigest: String(asset.manifestDigest),
        helperDigest: String(asset.helperDigest),
        workerDigest: String(asset.workerDigest),
      };
    } finally {
      lease.release();
    }
  }
  private nativeLease(label: string, signal?: AbortSignal) {
    return hostRuntime.acquire({
      owner: this.owner,
      kind: 'native-tool',
      label,
      cost: { process: 3, 'native.memory': 1024 * 1024 ** 2 },
      partitions: [{ key: 'seventh-native', limit: 1 }],
      signal,
    });
  }
  private releaseNativeLease(task: NativeTask) {
    nativeLeases.get(task.id)?.release();
    nativeLeases.delete(task.id);
  }
  private io<T>(task: NativeTask, run: () => Promise<T>, signal?: AbortSignal) {
    return storageRuntime.run(
      {
        owner: this.owner,
        taskId: task.id,
        label: 'native-original-task',
        paths: [task.workRoot],
        mode: 'write',
        buffers: 32 * 1024 ** 2,
        files: 1,
        signal,
      },
      run,
    );
  }
  async prepareNative(
    input: { workspaceId: string; planId: string; action: string; toolIdentity: SeventhToolIdentity },
    signal?: AbortSignal,
  ): Promise<SeventhNativeTaskTicket> {
    if (!CREATION_NATIVE_ACTIONS[this.packId]?.includes(input.action)) suiteFail('NATIVE_ACTION_UNSUPPORTED');
    const lease = await this.nativeLease(this.packId + ':prepare', signal);
    let task: NativeTask | undefined,
      sessionEntered = false;
    try {
      const options = seventhNativeOptions(),
        asset = await probeCreationNativeAssets({ ...options, signal, owner: this.owner });
      if (!sameTool(input.toolIdentity, asset as SeventhToolIdentity))
        suiteFail('NATIVE_TOOL_IDENTITY_STALE', '原生工具已改变，请重新预览', 409);
      task = await prepareNativeTask({ ...input, packId: this.packId }, asset, options);
      nativeLeases.set(task.id, lease);
      await this.io(
        task,
        () => {
          signal?.throwIfAborted();
          sessionEntered = true;
          return prepareCreationSession(task!.id, options, signal);
        },
        signal,
      );
      task = await updateNativeTask(task, (t) => {
        t.state = 'prepared';
        t.cleanup = 'pending';
      });
      return nativeTicket(task);
    } catch (error) {
      if (!task) {
        lease.release();
        throw error;
      }
      task = await updateNativeTask(task, (t) => {
        t.error = signal?.aborted
          ? { code: 'NATIVE_CANCELLED', message: '原任务已取消' }
          : nativeError(error);
        t.cleanup = sessionEntered ? 'unknown' : 'confirmed';
        t.state = sessionEntered
          ? 'cleanup-pending'
          : t.error.code === 'NATIVE_CANCELLED'
            ? 'cancelled'
            : 'failed';
      });
      if (sessionEntered) lease.cleanupPending(error);
      else this.releaseNativeLease(task);
      return nativeTicket(task);
    }
  }
  async acknowledgeNative(input: {
    workspaceId: string;
    planId: string;
    id: string;
    reference: SuiteRef;
  }): Promise<{ cleanup: 'confirmed' }> {
    const task = await getNativeTask(this.packId, input.workspaceId, input.planId, input.id);
    if (task.state === 'released') {
      await releaseNativeTask(task, input.reference);
      return { cleanup: 'confirmed' };
    }
    if (task.cleanup !== 'confirmed') suiteFail('NATIVE_CLEANUP_PENDING');
    await updateNativeTask(task, (t) => {
      if (t.reference && digest(t.reference) !== digest(input.reference))
        suiteFail('NATIVE_RESULT_REFERENCE_CHANGED');
      t.reference = input.reference;
    });
    await this.io(task, () => eraseCreationSession(task));
    await releaseNativeTask(task, input.reference);
    this.releaseNativeLease(task);
    return { cleanup: 'confirmed' };
  }
  async reconcileNative(
    input: { workspaceId: string; planId: string },
    signal?: AbortSignal,
  ): Promise<{
    ticket: SeventhNativeTaskTicket;
    cleanup: 'confirmed' | 'pending' | 'unknown';
    state: string;
    output?: SuiteJson;
    error?: { code: string; message: string };
  }> {
    let task = await getNativeTask(this.packId, input.workspaceId, input.planId);
    if (task.state === 'released')
      return {
        ticket: nativeTicket(task),
        cleanup: 'confirmed',
        state: task.error?.code === 'NATIVE_CANCELLED' ? 'cancelled' : task.error ? 'failed' : 'completed',
        ...(task.error ? { error: task.error } : {}),
      };
    let cleanup: 'confirmed' | 'pending' | 'unknown' = task.cleanup;
    let output: SuiteJson | undefined;
    const recoveryLease = nativeLeases.has(task.id)
      ? undefined
      : await this.nativeLease(this.packId + ':reconcile', signal);
    try {
      cleanup =
        task.cleanup === 'confirmed'
          ? 'confirmed'
          : await this.io(task, () => reconcileCreationSession(task, signal), signal);
      if (cleanup !== 'confirmed') {
        task = await updateNativeTask(task, (t) => {
          t.cleanup = cleanup;
          t.state = 'cleanup-pending';
        });
        return {
          ticket: nativeTicket(task),
          cleanup,
          state: task.state,
          ...(task.error ? { error: task.error } : {}),
        };
      }
      if (task.reference) {
        this.releaseNativeLease(task);
        return {
          ticket: nativeTicket(task),
          cleanup: 'confirmed',
          state: task.state,
          ...(task.error ? { error: task.error } : {}),
        };
      }
      if (task.error?.code === 'NATIVE_CANCELLED') {
        task = await updateNativeTask(task, (t) => {
          t.cleanup = 'confirmed';
          t.state = 'cancelled';
        });
        this.releaseNativeLease(task);
        return { ticket: nativeTicket(task), cleanup: 'confirmed', state: 'cancelled', error: task.error! };
      }
      if (task.inputDigest === null) {
        task = await updateNativeTask(task, (t) => {
          t.cleanup = 'confirmed';
          t.error ??= { code: 'NATIVE_NOT_STARTED', message: '原任务没有启动业务，原进程已确认核销' };
          t.state = t.error.code === 'NATIVE_CANCELLED' ? 'cancelled' : 'failed';
        });
        this.releaseNativeLease(task);
        return { ticket: nativeTicket(task), cleanup: 'confirmed', state: task.state, error: task.error! };
      }
      try {
        if (task.resultDigest)
          output = suiteJson.parse(
            await this.io(task, () => loadCreationSessionResult(task, task.resultDigest!)),
          );
        else {
          const payload = await this.io(task, () => loadCreationSessionPayload(task));
          if (digest(payload) !== task.inputDigest) suiteFail('NATIVE_INPUT_DIGEST');
          const actual = await this.io(task, () => readCreationSessionRequest(task)),
            raw = await this.io(task, () => readCreationSessionOutput(task));
          output = suiteJson.parse(
            await computeSeventhCreation(task.packId, task.action, payload, undefined, {
              executor: async (action, expected) => {
                if (action !== actual.action || digest(expected) !== digest(actual.input))
                  suiteFail('NATIVE_INPUT_BINDING');
                return raw;
              },
            }),
          );
          const saved = await this.io(task, () => saveCreationSessionResult(task, output));
          task = await updateNativeTask(task, (t) => {
            t.resultDigest = saved.digest;
          });
        }
        task = await updateNativeTask(task, (t) => {
          t.cleanup = 'confirmed';
          t.state = 'completed';
          t.error = null;
        });
      } catch (error) {
        task = await updateNativeTask(task, (t) => {
          t.cleanup = 'confirmed';
          t.error = nativeError(error);
          t.state = t.error.code === 'NATIVE_CANCELLED' ? 'cancelled' : 'failed';
        });
      }
      this.releaseNativeLease(task);
      return {
        ticket: nativeTicket(task),
        cleanup: 'confirmed',
        state: task.state,
        ...(output !== undefined ? { output } : {}),
        ...(task.error ? { error: task.error } : {}),
      };
    } finally {
      if (cleanup === 'confirmed') recoveryLease?.release();
      else if (recoveryLease) {
        nativeLeases.set(task.id, recoveryLease);
        recoveryLease.cleanupPending('Original native task remains unresolved');
      }
    }
  }
  async execute(
    input: {
      action: string;
      input: Record<string, SuiteJson>;
      workspaceId?: string;
      records?: SuiteRecord[];
      planId?: string;
      toolIdentity?: SeventhToolIdentity | null;
      nativeIntentId?: string;
    },
    signal?: AbortSignal,
  ): Promise<SuiteJson> {
    if (!(await this.actions()).includes(input.action))
      suiteFail('SEVENTH_ACTION_UNSUPPORTED', '此领域没有实现该计算动作', 422);
    if (CREATION_NATIVE_ACTIONS[this.packId]?.includes(input.action)) {
      if (!input.nativeIntentId || !input.workspaceId || !input.planId || !input.toolIdentity)
        suiteFail('NATIVE_INTENT_REQUIRED', '原生执行需要固定原意图和工具身份', 409);
      let task = await getNativeTask(this.packId, input.workspaceId, input.planId, input.nativeIntentId);
      if (task.action !== input.action || !sameTool(task.toolIdentity, input.toolIdentity))
        suiteFail('NATIVE_INTENT_CHANGED');
      if (task.state !== 'prepared')
        suiteFail('NATIVE_TASK_ALREADY_STARTED', '原任务只能执行一次，请恢复核销', 409);
      if(!nativeLeases.has(task.id))suiteFail('NATIVE_SESSION_ORIGINAL_OWNER_LOST','原准备已失去本机执行归属，请恢复核销',409);
      try {
        // 完整清单已在 prepare 的同一个 native 分区租约内、guard 启动之前核验。
        // 这里再遍历运行时会消耗 guard 的固定 10 秒启动窗口并触发撤销 ACL。
        const asset = await probeCreationNativeIdentity({
          assetRoot: task.assetRoot,
          signal,
          owner: this.owner,
        });
        if (!sameTool(task.toolIdentity, asset as SeventhToolIdentity))
          suiteFail('NATIVE_TOOL_IDENTITY_STALE');
        task = await claimNativeTask(task, digest(input.input));
        await this.io(task, () => saveCreationSessionPayload(task, input.input));
        const output = suiteJson.parse(
          await this.io(task, () =>
            computeSeventhCreation(this.packId, input.action, input.input, signal, {
              executor: (action, payload, activeSignal) =>
                startCreationSession(task, action, payload, activeSignal),
            }),
          ),
        );
        const saved = await this.io(task, () => saveCreationSessionResult(task, output));
        task = await updateNativeTask(task, (t) => {
          t.resultDigest = saved.digest;
          t.state = 'completed';
          t.cleanup = 'confirmed';
        });
        this.releaseNativeLease(task);
        return output;
      } catch (error) {
        let cleanup: 'confirmed' | 'pending' | 'unknown' = 'unknown';
        try {
          cleanup = await this.io(task, () => reconcileCreationSession(task));
        } catch {
          /* 保留原票据，后续仅按其身份恢复。 */
        }
        task = await updateNativeTask(task, (t) => {
          t.cleanup = cleanup;
          t.error = signal?.aborted
            ? { code: 'NATIVE_CANCELLED', message: '原任务已取消' }
            : nativeError(error);
          t.state =
            cleanup === 'confirmed'
              ? t.error.code === 'NATIVE_CANCELLED'
                ? 'cancelled'
                : 'failed'
              : 'cleanup-pending';
        });
        if (cleanup === 'confirmed') this.releaseNativeLease(task);
        else nativeLeases.get(task.id)?.cleanupPending(error);
        throw error;
      }
    }
    const wasmTrial = this.packId === 'extension-authoring-studio' && input.action === 'trials.run';
    const lifecycle = await this.lifecycle(input.action);
    const value = await computeRuntime.run<unknown>(
      {
        owner: this.owner,
        label: this.packId + ':' + input.action,
        memoryBytes: 448 * 1024 ** 2,
        timeoutMs: wasmTrial ? 1000 : 60000,
        signal,
        partition: { key: this.packId, limit: 1 },
      },
      () => ({
        source: new URL('./seventh-worker.mjs', import.meta.url),
        options: {
          workerData: {
            packId: this.packId,
            action: input.action,
            input: input.input,
            lifecycle,
            records: input.records ?? [],
            at: new Date().toISOString(),
          },
          resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
        },
      }),
    );
    return suiteJson.parse(value);
  }
}
