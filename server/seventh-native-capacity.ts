/** 原生工具字节与原任务持久预留；清理并移交证据后核销。 */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  SuiteExecutionLedger,
  suiteExecutionCapacitySpecs,
  executionQuota,
} from './suite-execution-capacity.ts';
import { suiteCapacity } from './suite-capacity.ts';
import { DATA, ROOT } from './paths.ts';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import {
  suiteQuota,
  suiteId,
  suiteDigest,
  suiteRef,
  type SuiteRef,
} from '../shared/contracts/suite-common.ts';
import type { SeventhToolIdentity, SeventhNativeTaskTicket } from '../shared/contracts/seventh-common.ts';
import { suiteFail } from './suite-store.ts';
import { digest } from './seventh-creation-common.ts';
const identity = z
  .object({ manifestDigest: suiteDigest, workerDigest: suiteDigest, helperDigest: suiteDigest })
  .strict();
const taskSchema = z
  .object({
    id: suiteId,
    reservationId: suiteId,
    workspaceId: suiteId,
    planId: suiteId,
    packId: z.string(),
    action: z.string(),
    toolIdentity: identity,
    digest: suiteDigest,
    state: z.enum([
      'preparing',
      'prepared',
      'running',
      'completed',
      'failed',
      'cancelled',
      'cleanup-pending',
      'released',
    ]),
    working: z.string(),
    assetRoot: z.string(),
    workRoot: z.string(),
    cleanup: z.enum(['confirmed', 'pending', 'unknown']),
    inputDigest: suiteDigest.nullable(),
    resultDigest: suiteDigest.nullable(),
    error: z.object({ code: z.string(), message: z.string() }).strict().nullable(),
    reference: suiteRef.nullable(),
  })
  .strict();
export type NativeTask = z.infer<typeof taskSchema>;
const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    quota: z.array(suiteQuota).max(50000),
    assets: z
      .array(
        z
          .object({
            digest: suiteDigest,
            bytes: z.number().int().positive(),
            location: z.string().optional(),
            reservationId: suiteId.optional(),
          })
          .strict(),
      )
      .max(100),
    tasks: z.array(taskSchema).max(10000).default([]),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
let ledger: SuiteExecutionLedger<State> | undefined;
function store() {
  return (ledger ??= new SuiteExecutionLedger<State>(
    suiteExecutionCapacitySpecs(DATA).find((s) => s.pluginId === 'suite-execution-native')!,
    suiteCapacity(),
    stateSchema,
    () => ({ schemaVersion: 1, quota: [], assets: [], tasks: [] }),
  ));
}
export const seventhNativeOptions = () => {
  const installed = join(ROOT, '.sakura-server', 'assets', 'seventh-creation');
  return {
    assetRoot: existsSync(join(installed, 'runtime-manifest.json'))
      ? installed
      : join(ROOT, '.tools', 'seventh-creation'),
    workRoot: join(DATA, 'seventh-creation'),
  };
};
function ensureAsset(
  s: State,
  workspaceId: string,
  asset: { manifestDigest: string; runtimeBytes: number; assetBytes?: number },
  assetRoot: string,
) {
  const actual = asset.assetBytes ?? asset.runtimeBytes,
    location = resolve(assetRoot).toLowerCase();
  if (!Number.isSafeInteger(actual) || actual <= 0) suiteFail('NATIVE_ASSET_SIZE');
  const existing = s.assets.find(
    (a) => a.digest === asset.manifestDigest && (a.location === location || !a.location),
  );
  if (existing) {
    const row =
      s.quota.find((q) => q.id === existing.reservationId) ??
      s.quota.find(
        (q) =>
          q.payloadDigest === existing.digest &&
          q.consumer === 'seventh-native-runtime' &&
          q.state !== 'released',
      );
    if (!row) suiteFail('NATIVE_ASSET_QUOTA_MISSING');
    if (actual < existing.bytes) suiteFail('NATIVE_ASSET_CAPACITY_CHANGED');
    row.bytes = actual;
    existing.bytes = actual;
    existing.location = location;
    existing.reservationId = row.id;
    return;
  }
  const previous = s.assets.filter((a) => a.location === location && a.digest !== asset.manifestDigest);
  if (
    previous.some((a) =>
      s.tasks.some((t) => t.toolIdentity.manifestDigest === a.digest && t.state !== 'released'),
    )
  )
    suiteFail('NATIVE_ASSET_IN_USE', '原工具仍有待核销任务', 409);
  for (const old of previous) {
    const row = s.quota.find((q) => q.id === old.reservationId);
    if (row) row.state = 'released';
    s.assets.splice(s.assets.indexOf(old), 1);
  }
  const bytes = executionQuota(workspaceId, 'seventh-native-runtime', actual, 'material');
  bytes.state = 'committed';
  bytes.payloadDigest = asset.manifestDigest;
  s.quota.push(bytes);
  s.assets.push({ digest: asset.manifestDigest, bytes: actual, location, reservationId: bytes.id });
}
export function nativeTicket(task: NativeTask): SeventhNativeTaskTicket {
  return {
    id: task.id,
    reservationId: task.reservationId,
    workspaceId: task.workspaceId,
    planId: task.planId,
    packId: task.packId,
    action: task.action,
    toolIdentity: task.toolIdentity,
    state: task.state,
    digest: task.digest,
  };
}
export async function prepareNativeTask(
  input: {
    workspaceId: string;
    planId: string;
    packId: string;
    action: string;
    toolIdentity: SeventhToolIdentity;
  },
  asset: { manifestDigest: string; runtimeBytes: number; assetBytes?: number },
  options: ReturnType<typeof seventhNativeOptions>,
) {
  suiteId.parse(input.workspaceId);
  suiteId.parse(input.planId);
  identity.parse(input.toolIdentity);
  const id = randomUUID(),
    temporary = executionQuota(input.workspaceId, 'seventh-native', 256 * 1024 ** 2, 'temporary');
  const binding = { id, reservationId: temporary.id, ...input };
  const task: NativeTask = {
    ...binding,
    digest: digest(binding),
    state: 'preparing',
    working: join(options.workRoot, 'task-' + id),
    ...options,
    cleanup: 'unknown',
    inputDigest: null,
    resultDigest: null,
    error: null,
    reference: null,
  };
  return store().change((s) => {
    if (s.tasks.some((t) => t.workspaceId === input.workspaceId && t.planId === input.planId))
      suiteFail('NATIVE_TASK_ALREADY_PREPARED', '原计划已有原生票据', 409);
    ensureAsset(s, input.workspaceId, asset, options.assetRoot);
    s.quota.push(temporary);
    s.tasks.push(task);
    return task;
  });
}
export async function getNativeTask(packId: string, workspaceId: string, planId: string, id?: string) {
  suiteId.parse(workspaceId);
  suiteId.parse(planId);
  const task = (await store().read()).tasks.find(
    (t) =>
      t.packId === packId && t.workspaceId === workspaceId && t.planId === planId && (!id || t.id === id),
  );
  return task ?? suiteFail('NATIVE_TASK_NOT_FOUND', '没有匹配的原生票据', 404);
}
export function updateNativeTask(task: NativeTask, edit: (current: NativeTask) => void) {
  return store().change((s) => {
    const row =
      s.tasks.find((t) => t.id === task.id && t.digest === task.digest) ?? suiteFail('NATIVE_TASK_CHANGED');
    edit(row);
    return row;
  }, true);
}
export async function claimNativeTask(task: NativeTask, inputDigest: string) {
  return updateNativeTask(task, (row) => {
    if (row.state !== 'prepared')
      suiteFail('NATIVE_TASK_ALREADY_STARTED', '原任务只能执行一次，请恢复核销', 409);
    row.state = 'running';
    row.inputDigest = inputDigest;
  });
}
export async function releaseNativeTask(task: NativeTask, reference: SuiteRef) {
  suiteRef.parse(reference);
  return store().change((s) => {
    const row =
      s.tasks.find((t) => t.id === task.id && t.digest === task.digest) ?? suiteFail('NATIVE_TASK_CHANGED');
    if (row.cleanup !== 'confirmed') suiteFail('NATIVE_CLEANUP_PENDING');
    if (row.reference && digest(row.reference) !== digest(reference))
      suiteFail('NATIVE_RESULT_REFERENCE_CHANGED');
    row.reference = reference;
    const quota =
      s.quota.find((q) => q.id === row.reservationId && q.workspaceId === row.workspaceId) ??
      suiteFail('NATIVE_RESERVATION_MISSING');
    quota.state = 'released';
    row.state = 'released';
    return row;
  }, true);
}
