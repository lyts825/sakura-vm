/** 五种固定工具共用原资源生命周期；档案只能由本体装配，公共 API 不接受执行器选择。 */
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import * as S from '../shared/contracts/seventh-execution.ts';
import { suiteQuota } from '../shared/contracts/suite-common.ts';
import type { ImageAssetsV1 } from './service-contracts/image-assets.ts';
import type { SuiteExecutionSessionsV1 } from './service-contracts/seventh-execution.ts';
import type { VmAccess } from './vm-access.ts';
import type { PluginDirectory } from './plugin-directory.ts';
import type { SuiteCapacity } from './suite-capacity.ts';
import type { SuiteExecutionProfile } from './suite-execution-profile.ts';
import {
  SuiteExecutionLedger,
  SuiteExecutionImageCapacity,
  suiteExecutionCapacitySpecs,
  executionQuota,
} from './suite-execution-capacity.ts';
import { SuiteExecutionFiles, executionSha } from './suite-execution-files.ts';
import { SuiteExecutionWatchdogs } from './suite-execution-watchdog.ts';
import { SuiteExecutionTransport } from './suite-execution-transport.ts';
import { CoreDrillValidation } from './core-drill-validation.ts';
import { qemuProcessPin, windowsProcessPin, windowsOriginalProcessStopped } from './vm-process-pin.ts';
import { vmLiveIdentity } from './vm-reference.ts';
import { resourceContext } from './host-runtime/context.ts';
import { captureOperationCheck, withoutOperationContext } from './operation-context.ts';
import { withoutPluginAuthority } from './plugin-authority.ts';
import { suiteActor, suiteCanonical, suiteHash } from './suite-store.ts';
import { quote } from './shell.ts';
import { DATA } from './paths.ts';
import type { SuiteExecutionCleanupFactory } from './suite-execution-cleanup.ts';

const MiB = 1024 ** 2,
  GiB = 1024 ** 3;
const row = z
  .object({
    receipt: S.suiteExecutionReceipt,
    owner: z.string(),
    retentionStarted: z.boolean(),
    outputStarted: z.boolean(),
    materialsReleased: z.boolean(),
    vmQuota: z.uuid(),
    outputQuota: z.uuid(),
    temporaryQuota: z.uuid(),
  })
  .strict();
const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    quota: z.array(suiteQuota).max(10000),
    plans: z.array(S.suiteExecutionPlan).max(1000),
    sessions: z.array(row).max(1000),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
type Who = Pick<S.SuiteExecutionPlan, 'actor' | 'consumer' | 'generation'>;
type Active = { abort: AbortController; done: Promise<void>; cancelled: boolean };
const guardian = new URL('./suite-execution-guardian.py', import.meta.url);
function fail(code: string, message = code): never {
  throw new AppError(message, 409, code);
}
const liveState = (state: S.SuiteExecutionReceipt['state']) => state === 'preparing' || state === 'running';
const cleanupContext = <T>(work: () => T) => withoutOperationContext(() => withoutPluginAuthority(work));
const proof = z
  .object({
    format: z.literal('sakura-suite-guardian/1'),
    sessionId: z.uuid(),
    uid: z.literal(65534),
    gid: z.literal(65534),
    pid: z.number().int().positive(),
    startTicks: z.string().regex(/^\d+$/),
    exitCode: z.number().int(),
    reason: z.string(),
    elapsedMs: z.number().nonnegative(),
    worker: z.unknown(),
  })
  .strict();

export class SuiteExecutionSessions implements SuiteExecutionSessionsV1 {
  private readonly ledger: SuiteExecutionLedger<State>;
  private readonly files: SuiteExecutionFiles;
  private readonly images: SuiteExecutionImageCapacity;
  private readonly validation: CoreDrillValidation;
  private watches?: SuiteExecutionWatchdogs;
  private active = new Map<string, Active>();
  private writingPreviews = new Set<string>();
  private sweeping: Promise<void> | undefined;
  private closing = false;
  constructor(
    private machines: VmAccess,
    private assets: ImageAssetsV1,
    private directory: PluginDirectory,
    capacity: SuiteCapacity,
    private profile: SuiteExecutionProfile,
    private cleanupFactory: SuiteExecutionCleanupFactory,
    private data = DATA,
  ) {
    const spec = suiteExecutionCapacitySpecs(data).find(
      (s) => s.pluginId === 'suite-execution-' + profile.id,
    )!;
    this.ledger = new SuiteExecutionLedger(spec, capacity, stateSchema, () => ({
      schemaVersion: 1,
      quota: [],
      plans: [],
      sessions: [],
    }));
    this.files = new SuiteExecutionFiles(join(data, 'suite-execution', profile.id, 'materials'));
    this.images = new SuiteExecutionImageCapacity(data, capacity);
    this.validation = new CoreDrillValidation(machines);
  }
  async init() {
    await this.images.init();
    await this.ledger.change((state) => {
      for (const plan of state.plans) if (plan.state === 'ready') plan.state = 'expired';
      for (const { receipt } of state.sessions)
        if (liveState(receipt.state)) {
          receipt.state = 'interrupted';
          receipt.outcome = 'inconclusive';
          receipt.cleanup = 'unknown';
          receipt.error = 'SUITE_EXECUTION_HOST_RESTART';
          receipt.updatedAt = new Date().toISOString();
        }
    }, true);
    await this.reapPreviews();
  }
  /** Only expired, never-consumed plans can lose their original immutable input. */
  private async reapPreviews() {
    if (this.sweeping) return this.sweeping;
    this.sweeping = cleanupContext(async () => {
      const plans = await this.ledger.change((state) => {
        const selected = state.plans.filter(
          (plan) =>
            !plan.sessionId &&
            !this.writingPreviews.has(plan.id) &&
            (plan.state === 'expired' ||
              (plan.state === 'ready' && Date.parse(plan.expiresAt) <= Date.now())) &&
            state.quota.some((quota) => quota.slot === plan.id && quota.state !== 'released'),
        );
        for (const plan of selected) plan.state = 'expired';
        return selected;
      }, true);
      for (const plan of plans) {
        try {
          await this.files.remove(plan.id, 'input', plan.inputDigest, this.profile.maximumInputBytes);
        } catch {
          continue; /* Changed or partial original material remains charged for explicit recovery. */
        }
        await this.ledger.change((state) => {
          const original = state.plans.find((value) => value.id === plan.id);
          if (
            !original ||
            original.sessionId ||
            original.state !== 'expired' ||
            original.inputDigest !== plan.inputDigest
          )
            fail('SUITE_EXECUTION_PLAN_CHANGED');
          for (const quota of state.quota) if (quota.slot === plan.id) quota.state = 'released';
        }, true);
      }
    }).finally(() => {
      this.sweeping = undefined;
    });
    return this.sweeping;
  }
  private caller(): Who {
    if (this.closing) fail('SUITE_EXECUTION_CLOSED');
    const c = resourceContext(),
      consumer = c?.serviceConsumerPluginInstanceId || c?.callerPluginInstanceId,
      generation = c?.serviceConsumerPluginGeneration || c?.callerPluginGeneration;
    if (!consumer || !generation || !this.profile.consumers.includes(consumer))
      fail('SUITE_EXECUTION_CONSUMER');
    const who = { actor: suiteActor(), consumer, generation };
    this.current(who);
    return who;
  }
  private current(who: Who) {
    const instance = this.directory.get('official', who.consumer.replace(/^official:/, ''));
    if (!instance || instance.identity !== who.consumer || instance.generation !== who.generation)
      fail('SUITE_EXECUTION_GENERATION');
    instance.check();
  }
  private owns(value: Who & { workspaceId: string }, workspaceId: string, who: Who, original = false) {
    if (
      value.workspaceId !== workspaceId ||
      value.actor !== who.actor ||
      value.consumer !== who.consumer ||
      (original && value.generation !== who.generation)
    )
      fail('SUITE_EXECUTION_SCOPE');
  }
  private async toolBytes() {
    const worker = await readFile(this.profile.worker),
      guard = await readFile(guardian);
    const digest = suiteHash({
      profile: this.profile.id,
      worker: executionSha(worker),
      guardian: executionSha(guard),
      probe: this.profile.probe,
      memoryMiB: this.profile.memoryMiB,
      cpus: this.profile.cpus,
      maximumSeconds: this.profile.maximumSeconds,
    });
    return { worker, guard, digest };
  }
  async tool() {
    await this.reapPreviews();
    await this.images.synchronize(await this.cleanupFactory.imageInventory());
    const { digest } = await this.toolBytes(),
      view = await this.validation.view();
    return S.suiteExecutionTool.parse({
      id: this.profile.id,
      digest,
      available: view.host,
      platform: process.platform,
      maximumSeconds: this.profile.maximumSeconds,
      maximumInputBytes: this.profile.maximumInputBytes,
      maximumOutputBytes: this.profile.maximumOutputBytes,
      gaps: view.host ? [] : view.gaps,
    });
  }
  async preview(raw: z.infer<typeof S.suiteExecutionPreview>) {
    const input = S.suiteExecutionPreview.parse(raw),
      who = this.caller(),
      check = captureOperationCheck();
    await check();
    await this.reapPreviews();
    const parsed = this.profile.input.parse(input.input),
      bytes = Buffer.from(suiteCanonical(parsed));
    if (
      suiteHash(parsed) !== input.inputDigest ||
      bytes.length > this.profile.maximumInputBytes ||
      input.maxSeconds > this.profile.maximumSeconds
    )
      fail('SUITE_EXECUTION_INPUT_BUDGET');
    const asset = await this.assets.verify(input.image);
    if (asset.architecture !== 'x86_64') fail('SUITE_EXECUTION_PLATFORM_UNSUPPORTED');
    await this.validation.ensureHost();
    const { digest } = await this.toolBytes();
    await this.images.ensure(asset, input.workspaceId);
    await check();
    this.current(who);
    const id = randomUUID(),
      now = new Date().toISOString();
    const base = {
      id,
      profile: this.profile.id,
      workspaceId: input.workspaceId,
      ...who,
      image: input.image,
      inputDigest: input.inputDigest,
      toolDigest: digest,
      createdAt: now,
      expiresAt: new Date(Date.now() + 5 * 60000).toISOString(),
      maxSeconds: input.maxSeconds,
      budget: {
        virtualBytes: Math.max(8, Math.ceil(asset.virtualBytes / GiB)) * GiB,
        imageBytes: asset.bytes,
        memoryMiB: this.profile.memoryMiB,
        cpus: this.profile.cpus,
        inputBytes: bytes.length,
        outputBytes: this.profile.maximumOutputBytes,
      },
      state: 'ready' as const,
      sessionId: null,
    };
    const plan = S.suiteExecutionPlan.parse({ ...base, digest: suiteHash(base) });
    const quota = executionQuota(plan.workspaceId, who.consumer, bytes.length, 'material');
    quota.slot = id;
    await this.ledger.change((s) => {
      s.plans.push(plan);
      s.quota.push(quota);
    });
    this.writingPreviews.add(id);
    try {
      await this.files.put(id, 'input', bytes);
      await check();
      this.current(who);
      await this.ledger.change((s) => {
        const current = s.plans.find((plan) => plan.id === id)!;
        if (current.state !== 'ready' || current.sessionId || Date.parse(current.expiresAt) <= Date.now())
          fail('SUITE_EXECUTION_PLAN_EXPIRED');
        s.quota.find((q) => q.id === quota.id)!.state = 'committed';
      });
      return plan;
    } catch (error) {
      await cleanupContext(() =>
        this.ledger.change((s) => {
          s.plans.find((p) => p.id === id)!.state = 'expired';
        }, true),
      );
      throw error;
    } finally {
      this.writingPreviews.delete(id);
      await this.reapPreviews();
    }
  }
  private async record(id: string, patch: Partial<S.SuiteExecutionReceipt>) {
    return this.ledger.change((s) => {
      const value = s.sessions.find((r) => r.receipt.id === id);
      if (!value) fail('SUITE_EXECUTION_NOT_FOUND');
      Object.assign(value.receipt, patch, { updatedAt: new Date().toISOString() });
      return value.receipt;
    }, true);
  }
  async start(
    raw: z.infer<typeof S.suiteExecutionApproval>,
    commitIntent: (challenge: S.SuiteExecutionChallenge) => Promise<{ intentDigest: string }>,
    authorize: () => Promise<void>,
  ) {
    const input = S.suiteExecutionApproval.parse(raw),
      who = this.caller(),
      originalCheck = captureOperationCheck();
    const check = async () => {
      if (this.closing) fail('SUITE_EXECUTION_CLOSED');
      await originalCheck();
      this.current(who);
      await authorize();
    };
    await check();
    const plan = (await this.ledger.read()).plans.find((p) => p.id === input.planId);
    if (!plan || plan.digest !== input.digest) fail('SUITE_EXECUTION_PLAN_CHANGED');
    this.owns(plan, input.workspaceId, who, true);
    if (plan.sessionId) return this.inspect({ workspaceId: input.workspaceId, id: plan.sessionId });
    if (plan.state !== 'ready' || Date.parse(plan.expiresAt) <= Date.now())
      fail('SUITE_EXECUTION_PLAN_EXPIRED');
    const bytes = await this.files.read(plan.id, 'input', plan.inputDigest, this.profile.maximumInputBytes),
      tool = await this.toolBytes();
    if (tool.digest !== plan.toolDigest) fail('SUITE_EXECUTION_TOOL_CHANGED');
    await this.assets.verify(plan.image);
    await this.validation.ensureHost();
    await check();
    const id = randomUUID(),
      now = new Date().toISOString(),
      vm = executionQuota(plan.workspaceId, who.consumer, plan.budget.virtualBytes, 'temporary'),
      output = executionQuota(plan.workspaceId, who.consumer, plan.budget.outputBytes, 'material'),
      temporary = executionQuota(
        plan.workspaceId,
        who.consumer,
        plan.budget.imageBytes + 2 * plan.budget.inputBytes + 2 * plan.budget.outputBytes + MiB,
        'temporary',
      );
    const receipt = S.suiteExecutionReceipt.parse({
      id,
      planId: plan.id,
      profile: this.profile.id,
      workspaceId: plan.workspaceId,
      ...who,
      state: 'preparing',
      outcome: 'inconclusive',
      cleanup: 'pending',
      createdAt: now,
      updatedAt: now,
      deadline: new Date(Date.now() + (plan.maxSeconds + 180) * 1000).toISOString(),
      inputDigest: plan.inputDigest,
      toolDigest: plan.toolDigest,
      intentDigest: null,
      vm: null,
      identity: null,
      tools: {},
      output: null,
      error: null,
    });
    const duplicate = await this.ledger.change((s) => {
      const current = s.plans.find((p) => p.id === plan.id)!;
      if (current.sessionId) return s.sessions.find((row) => row.receipt.id === current.sessionId)!.receipt;
      if (current.state !== 'ready') fail('SUITE_EXECUTION_PLAN_CONSUMED');
      if (Date.parse(current.expiresAt) <= Date.now()) fail('SUITE_EXECUTION_PLAN_EXPIRED');
      if (s.sessions.some((r) => r.receipt.cleanup !== 'confirmed')) fail('SUITE_EXECUTION_ACTIVE_LIMIT');
      current.state = 'consumed';
      current.sessionId = id;
      s.quota.push(vm, output, temporary);
      s.sessions.push({
        receipt,
        owner: who.consumer.replace(/^official:/, '') + ':' + id,
        retentionStarted: false,
        outputStarted: false,
        materialsReleased: false,
        vmQuota: vm.id,
        outputQuota: output.id,
        temporaryQuota: temporary.id,
      });
      return null;
    });
    if (duplicate) return duplicate;
    try {
      const intent = z
        .object({ intentDigest: z.string().regex(/^[a-f0-9]{64}$/) })
        .strict()
        .parse(
          await commitIntent({
            sessionId: id,
            planId: plan.id,
            digest: plan.digest,
            inputDigest: plan.inputDigest,
            budget: plan.budget,
          }),
        );
      await check();
      await this.record(id, intent);
    } catch (error) {
      await cleanupContext(async () => {
        await this.record(id, { state: 'failed', error: 'SUITE_EXECUTION_INTENT_UNCONFIRMED' });
        await this.cleanup(id);
      });
      throw error;
    }
    const active: Active = { abort: new AbortController(), done: Promise.resolve(), cancelled: false };
    this.active.set(id, active);
    active.done = this.run(receipt, plan, bytes, tool, active, check).finally(() => this.active.delete(id));
    // The result is durable before the background lifecycle can create a VM.
    void active.done.catch(() => {});
    return (await this.ledger.read()).sessions.find((r) => r.receipt.id === id)!.receipt;
  }
  private async watchdogs() {
    if (!this.watches) {
      const controller = await windowsProcessPin(process.pid);
      this.watches = new SuiteExecutionWatchdogs(
        join(this.data, 'suite-execution', this.profile.id, 'guards'),
        this.validation.executable,
        controller.created,
      );
    }
    return this.watches;
  }
  private async run(
    receipt: S.SuiteExecutionReceipt,
    plan: S.SuiteExecutionPlan,
    bytes: Buffer,
    tool: Awaited<ReturnType<SuiteExecutionSessions['toolBytes']>>,
    active: Active,
    authorize: () => Promise<void>,
  ) {
    let heartbeat: Promise<void> | undefined,
      heartDone = false,
      result: unknown;
    const check = async () => {
      active.abort.signal.throwIfAborted();
      await authorize();
      // Ordinary provider authority is renewed while work is active; original cleanup has its own narrow port.
      await this.assets.inspect(plan.image);
      if (Date.now() >= Date.parse(receipt.deadline)) fail('SUITE_EXECUTION_DEADLINE');
    };
    try {
      await check();
      const saved = (await this.ledger.read()).sessions.find((r) => r.receipt.id === receipt.id)!;
      await this.ledger.change((s) => {
        s.sessions.find((r) => r.receipt.id === receipt.id)!.retentionStarted = true;
      }, true);
      await this.assets.retain(plan.image, saved.owner);
      const owned = await this.assets.createOwnedVm({
        imageRef: plan.image,
        owner: saved.owner,
        name: 'suite-' + this.profile.id + '-' + receipt.id.slice(0, 8),
        memoryMiB: plan.budget.memoryMiB,
        cpus: plan.budget.cpus,
        network: 'isolated',
        persistent: false,
        lifetimeMinutes: Math.ceil((plan.maxSeconds + 180) / 60),
      });
      await this.record(receipt.id, { vm: owned });
      await check();
      await this.machines.start(owned.vmId);
      const visible = this.machines.live.get(owned.vmId);
      if (!visible) fail('SUITE_EXECUTION_VM_STOPPED');
      const original = vmLiveIdentity(visible);
      const pinUntil = Date.now() + 10000;
      let pin: Awaited<ReturnType<typeof qemuProcessPin>>;
      for (;;) {
        try {
          // QEMU creates its random pidfile before writing the PID. Only that empty-file phase is retryable.
          if (original.processRecordFile) {
            const pending = await lstat(original.processRecordFile);
            if (
              pending.isFile() &&
              !pending.isSymbolicLink() &&
              pending.nlink === 1 &&
              pending.size === 0 &&
              Date.now() < pinUntil
            ) {
              await check();
              await delay(50, undefined, { signal: active.abort.signal });
              continue;
            }
          }
          pin = await qemuProcessPin(original);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || Date.now() >= pinUntil) throw error;
          await check();
          await delay(50, undefined, { signal: active.abort.signal });
        }
      }
      await (await this.watchdogs()).start(receipt.id, pin, receipt.deadline);
      await this.record(receipt.id, {
        identity: {
          processId: pin.pid,
          processCreated: pin.created,
          startedAt: original.startedAt,
          bootId: null,
        },
      });
      if (original.processArguments?.some((arg) => /virtfs|fsdev|vhost-user-fs|virtio-9p|virtiofs/.test(arg)))
        fail('SUITE_EXECUTION_HOST_SHARE');
      const vm = this.machines.get(owned.vmId),
        network = await this.machines.networkIsolation(owned.vmId, owned.createdAt, original.startedAt);
      if (
        vm.createdAt !== owned.createdAt ||
        vm.managedNetwork !== 'isolated' ||
        vm.forwards.length ||
        !network.isolated ||
        vm.memoryMiB > plan.budget.memoryMiB ||
        vm.cpus > plan.budget.cpus
      )
        fail('SUITE_EXECUTION_VM_BOUNDARY');
      const readyUntil = Math.min(Date.now() + 180000, Date.parse(receipt.deadline));
      while (this.machines.live.get(owned.vmId)?.status !== 'running') {
        await check();
        if (!this.machines.live.has(owned.vmId) || Date.now() > readyUntil)
          fail('SUITE_EXECUTION_BOOT_TIMEOUT');
        await delay(500, undefined, { signal: active.abort.signal });
      }
      await check();
      const probeResult = await this.machines.exec(
        owned.vmId,
        this.profile.probe + '\ncat /proc/sys/kernel/random/boot_id',
        20000,
        active.abort.signal,
      );
      if (probeResult.code !== 0)
        fail('SUITE_EXECUTION_RUNTIME_NOT_PREPARED', '固定工具依赖尚未准备；请显式准备镜像');
      const lines = probeResult.stdout.trim().split(/\r?\n/),
        bootId = z.uuid().parse(lines.pop()),
        tools = this.profile.probeResult(lines.join('\n'));
      await this.record(receipt.id, {
        tools,
        identity: { processId: pin.pid, processCreated: pin.created, startedAt: original.startedAt, bootId },
      });
      const transport = new SuiteExecutionTransport(
        this.machines,
        owned.vmId,
        receipt.id,
        check,
        active.abort.signal,
      );
      const root = transport.root;
      await transport.initialize();
      await transport.put('worker.py', tool.worker, 1024 * 1024);
      await transport.put('guardian.py', tool.guard, 1024 * 1024);
      const deadline = new Date(
        Math.min(Date.parse(receipt.deadline), Date.now() + plan.maxSeconds * 1000),
      ).toISOString();
      const envelope = Buffer.from(
        JSON.stringify({
          sessionId: receipt.id,
          deadline,
          inputDigest: plan.inputDigest,
          input: JSON.parse(bytes.toString('utf8')),
        }),
      );
      await transport.put('input.json', envelope, 8 * MiB);
      const grant =
        'import pathlib,json,time,os\nr=pathlib.Path(' +
        JSON.stringify(root) +
        ")\np=r/'permit.next'\nwith p.open('w') as f: json.dump({'sessionId':" +
        JSON.stringify(receipt.id) +
        ",'until':time.monotonic()+3},f);f.flush();os.fsync(f.fileno())\nos.chmod(p,0o600)\nos.replace(p,r/'permit.json')";
      const renew = async () => {
        await check();
        const renewed = await this.machines.exec(
          owned.vmId,
          'python3 -I -S -c ' + quote(grant),
          2500,
          active.abort.signal,
        );
        if (renewed.code !== 0) fail('SUITE_EXECUTION_PERMIT_FAILED');
      };
      await renew();
      heartbeat = (async () => {
        while (!heartDone) {
          await delay(750, undefined, { signal: active.abort.signal });
          if (!heartDone) await renew();
        }
      })().catch((error) => {
        if (!heartDone) active.abort.abort(error);
      });
      await this.record(receipt.id, { state: 'running' });
      const execution = await this.machines.exec(
        owned.vmId,
        'python3 -I -S ' +
          quote(root + '/guardian.py') +
          ' ' +
          quote(root) +
          ' ' +
          quote(receipt.id) +
          ' < ' +
          quote(root + '/input.json'),
        Math.min(Date.parse(deadline) - Date.now() + 5000, Date.parse(receipt.deadline) - Date.now()),
        active.abort.signal,
      );
      await check();
      if (execution.code !== 0 || Buffer.byteLength(execution.stdout) > 2048)
        fail('SUITE_EXECUTION_WORKER_FAILED');
      const transported = await transport.read(JSON.parse(execution.stdout));
      const output = proof.parse(JSON.parse(transported.toString('utf8')));
      await this.record(receipt.id, {
        worker: {
          pid: output.pid,
          startTicks: output.startTicks,
          uid: output.uid,
          gid: output.gid,
          exitCode: output.exitCode,
          reason: output.reason,
          elapsedMs: output.elapsedMs,
        },
      });
      if (
        output.sessionId !== receipt.id ||
        output.exitCode !== 0 ||
        output.reason !== 'returned' ||
        !output.worker
      )
        fail('SUITE_EXECUTION_WORKER_INCOMPLETE');
      result = output.worker;
      const encoded = Buffer.from(suiteCanonical(result));
      if (encoded.length > plan.budget.outputBytes) fail('SUITE_EXECUTION_OUTPUT_LIMIT');
      await this.ledger.change((s) => {
        s.sessions.find((r) => r.receipt.id === receipt.id)!.outputStarted = true;
      }, true);
      await this.files.put(receipt.id, 'output', encoded);
      await this.ledger.change((s) => {
        const row = s.sessions.find((r) => r.receipt.id === receipt.id)!,
          q = s.quota.find((q) => q.id === row.outputQuota)!;
        q.state = 'committed';
        q.bytes = encoded.length;
        row.receipt.output = { bytes: encoded.length, digest: executionSha(encoded) };
      });
      await check();
      await this.record(receipt.id, { state: 'completed', outcome: this.profile.outcome(result) });
    } catch (error) {
      await cleanupContext(() =>
        this.record(receipt.id, {
          state: active.cancelled ? 'cancelled' : active.abort.signal.aborted ? 'interrupted' : 'failed',
          outcome: 'inconclusive',
          error:
            error instanceof AppError ? error.code || 'SUITE_EXECUTION_FAILED' : 'SUITE_EXECUTION_FAILED',
        }),
      );
    } finally {
      heartDone = true;
      active.abort.abort();
      await heartbeat;
      await cleanupContext(async () => {
        try {
          await this.cleanup(receipt.id);
        } catch {
          await this.record(receipt.id, {
            cleanup: 'unknown',
            outcome: 'inconclusive',
            error: 'SUITE_EXECUTION_CLEANUP_UNKNOWN',
          });
        }
      });
    }
  }
  private async cleanup(id: string) {
    const saved = (await this.ledger.read()).sessions.find((r) => r.receipt.id === id)!;
    if (!saved) fail('SUITE_EXECUTION_NOT_FOUND');
    if (saved.receipt.identity) {
      try {
        await (await (await this.watchdogs()).reconnect(id)).contain();
      } catch {
        /* Original authoritative VM destruction below remains available. */
      }
    }
    const actual = saved.retentionStarted ? await (await this.cleanupFactory(saved.receipt))() : null;
    if (saved.receipt.vm && !actual) fail('SUITE_EXECUTION_RESOURCE_MISSING');
    if (actual && actual.cleanup !== 'confirmed') fail('SUITE_EXECUTION_CLEANUP_UNKNOWN');
    if (
      saved.receipt.identity &&
      !(await windowsOriginalProcessStopped(
        saved.receipt.identity.processId,
        saved.receipt.identity.processCreated,
      ))
    )
      fail('SUITE_EXECUTION_PROCESS_REMAINS');
    await this.ledger.change((s) => {
      const r = s.sessions.find((r) => r.receipt.id === id)!;
      r.receipt.cleanup = 'confirmed';
      if (actual) r.receipt.vm = actual;
      r.receipt.updatedAt = new Date().toISOString();
      for (const q of s.quota)
        if (q.id === r.vmQuota || q.id === r.temporaryQuota || (q.id === r.outputQuota && !r.outputStarted))
          q.state = 'released';
    }, true);
  }
  async inspect(raw: z.infer<typeof S.suiteExecutionPin>) {
    const input = S.suiteExecutionPin.parse(raw),
      who = this.caller();
    await captureOperationCheck()();
    const r = (await this.ledger.read()).sessions.find((r) => r.receipt.id === input.id);
    if (!r) fail('SUITE_EXECUTION_NOT_FOUND');
    this.owns(r.receipt, input.workspaceId, who);
    return r.receipt;
  }
  /** 新四类提供者允许按原批准定位原会话；恢复不创建资源，也不重放输入。 */
  async resolve(raw: { workspaceId: string; planId: string }): Promise<S.SuiteExecutionReceipt | null> {
    const input = z.object({ workspaceId: z.uuid(), planId: z.uuid() }).strict().parse(raw),
      who = this.caller();
    await captureOperationCheck()();
    const plan = (await this.ledger.read()).plans.find((p) => p.id === input.planId);
    if (!plan) fail('SUITE_EXECUTION_PLAN_CHANGED');
    this.owns(plan, input.workspaceId, who);
    return plan.sessionId ? this.inspect({ workspaceId: input.workspaceId, id: plan.sessionId }) : null;
  }
  async cancel(raw: z.infer<typeof S.suiteExecutionPin>) {
    const input = S.suiteExecutionPin.parse(raw);
    await this.inspect(input);
    const active = this.active.get(input.id);
    if (active) {
      active.cancelled = true;
      active.abort.abort(new AppError('原会话已取消', 409, 'SUITE_EXECUTION_CANCELLED'));
      await active.done;
    } else await cleanupContext(() => this.cleanup(input.id));
    return this.inspect(input);
  }
  async reconcile(raw: z.infer<typeof S.suiteExecutionPin>) {
    const input = S.suiteExecutionPin.parse(raw);
    await this.inspect(input);
    if (this.active.has(input.id)) return this.inspect(input);
    await cleanupContext(() => this.cleanup(input.id));
    return this.inspect(input);
  }
  async output(raw: z.infer<typeof S.suiteExecutionOutputInput>) {
    const input = S.suiteExecutionOutputInput.parse(raw),
      receipt = await this.inspect({ workspaceId: input.workspaceId, id: input.id }),
      who = this.caller(),
      check = captureOperationCheck();
    if ((await this.ledger.read()).sessions.find((r) => r.receipt.id === receipt.id)!.materialsReleased)
      fail('SUITE_EXECUTION_MATERIAL_RELEASED');
    if (!receipt.output || receipt.cleanup !== 'confirmed') fail('SUITE_EXECUTION_OUTPUT_UNAVAILABLE');
    const bytes = await this.files.read(
      receipt.id,
      'output',
      receipt.output.digest,
      this.profile.maximumOutputBytes,
    );
    if (input.offset > bytes.length) fail('SUITE_EXECUTION_OUTPUT_OFFSET');
    const part = bytes.subarray(input.offset, input.offset + input.length);
    await check();
    this.current(who);
    return S.suiteExecutionOutput.parse({
      data: part.toString('base64'),
      offset: input.offset + part.length,
      eof: input.offset + part.length === bytes.length,
      digest: receipt.output.digest,
      total: bytes.length,
    });
  }
  async release(raw: z.infer<typeof S.suiteExecutionPin>) {
    const input = S.suiteExecutionPin.parse(raw),
      receipt = await this.inspect(input);
    if (receipt.cleanup !== 'confirmed' || this.active.has(receipt.id))
      fail('SUITE_EXECUTION_CLEANUP_PENDING');
    const state = await this.ledger.read(),
      saved = state.sessions.find((r) => r.receipt.id === receipt.id)!,
      plan = state.plans.find((p) => p.id === receipt.planId)!;
    if (saved.materialsReleased) return receipt;
    if (saved.outputStarted && !receipt.output) fail('SUITE_EXECUTION_OUTPUT_UNCONFIRMED');
    await this.files.remove(plan.id, 'input', plan.inputDigest, this.profile.maximumInputBytes);
    if (receipt.output)
      await this.files.remove(receipt.id, 'output', receipt.output.digest, this.profile.maximumOutputBytes);
    await this.ledger.change((s) => {
      s.sessions.find((r) => r.receipt.id === receipt.id)!.materialsReleased = true;
      for (const q of s.quota) if (q.slot === plan.id || q.id === saved.outputQuota) q.state = 'released';
    }, true);
    return receipt;
  }
  async discardPreview(raw: z.infer<typeof S.suiteExecutionApproval>) {
    const input = S.suiteExecutionApproval.parse(raw),
      who = this.caller();
    await captureOperationCheck()();
    const plan = (await this.ledger.read()).plans.find((p) => p.id === input.planId);
    if (!plan || plan.digest !== input.digest) fail('SUITE_EXECUTION_PLAN_CHANGED');
    this.owns(plan, input.workspaceId, who);
    if (plan.sessionId) fail('SUITE_EXECUTION_PLAN_CONSUMED');
    await this.ledger.change((s) => {
      s.plans.find((p) => p.id === plan.id)!.state = 'expired';
    }, true);
    await this.files.remove(plan.id, 'input', plan.inputDigest, this.profile.maximumInputBytes);
    return this.ledger.change((s) => {
      for (const q of s.quota) if (q.slot === plan.id) q.state = 'released';
      return s.plans.find((p) => p.id === plan.id)!;
    }, true);
  }
  async close() {
    this.closing = true;
    for (const task of this.active.values())
      task.abort.abort(new AppError('宿主正在关闭', 503, 'SUITE_EXECUTION_CLOSED'));
    await Promise.allSettled([...this.active.values()].map((task) => task.done));
    await this.watches?.close();
  }
}
