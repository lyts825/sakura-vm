/** 固定客户机工具、持久许可和原身份核销。 Fixed guest worker sessions and durable single-use grants. */
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type {
  PreparedWorkerSessionsV1,
  PreparedWorkerHooks,
} from './service-contracts/prepared-worker-sessions.ts';
import type { IntegrationMetadataFactory } from './integration-specs.ts';
import { IntegrationRows, ilHash, ilFail, ilConsumer } from './integration-store.ts';
import { resourceContext } from './host-runtime/context.ts';
import { captureOperationCheck } from './operation-context.ts';
import { projectIdentityTask, ProjectRunScopes } from './project-run-scope.ts';
import { projectSchema } from './project-config.ts';
import { quote } from './shell.ts';
import {
  workerPlanSchema,
  workerPlanInputSchema,
  workerReceiptSchema,
  workerEventSchema,
  type PreparedWorkerReceipt,
  type PreparedWorkerPlan,
  type IntegrationWorkerEvent,
} from '../shared/contracts/integration-worker.ts';
const toolPath = fileURLToPath(new URL('./integration-http-worker.py', import.meta.url));
type Active = { abort: AbortController; done: Promise<void>; live: unknown; tail: Promise<void> };
export class PreparedWorkerSessions implements PreparedWorkerSessionsV1 {
  private plans;
  private receipts;
  private grants;
  private active = new Map<string, Active>();
  constructor(
    private machines: VmAccess,
    private workspaces: () => WorkspacesV1,
    meta: IntegrationMetadataFactory,
  ) {
    this.plans = new IntegrationRows(meta('plans'), workerPlanSchema);
    this.receipts = new IntegrationRows(meta('receipts'), workerReceiptSchema);
    this.grants = new IntegrationRows(
      meta('grants'),
      z
        .object({
          id: z.uuid(),
          sessionId: z.uuid(),
          challenge: z.uuid(),
          digest: z.string(),
          intentDigest: z.string(),
          consumer: z.string(),
          generation: z.string(),
          sequence: z.number().int(),
          type: z.enum(['permit', 'batch', 'heartbeat']),
          at: z.iso.datetime(),
        })
        .strict(),
    );
  }
  async tool() {
    return {
      id: 'integration-http-v1' as const,
      digest: createHash('sha256')
        .update(await readFile(toolPath))
        .digest('hex'),
    };
  }
  private caller() {
    ilConsumer('integration-runners');
    const c = resourceContext()!;
    if (!c.serviceConsumerPluginGeneration) ilFail('WORKER_CONSUMER_GENERATION_REQUIRED');
    return {
      consumer: c.serviceConsumerPluginInstanceId || c.callerPluginInstanceId!,
      generation: c.serviceConsumerPluginGeneration,
    };
  }
  private async check(plan: PreparedWorkerPlan, original = true) {
    const who = this.caller();
    if (who.consumer !== plan.consumer || (original && who.generation !== plan.generation))
      ilFail('WORKER_CONSUMER_CHANGED');
    const vm = this.machines.get(plan.ownedVmReceipt.vmId);
    if (
      vm.createdAt !== plan.ownedVmReceipt.createdAt ||
      !plan.ownedVmReceipt.owner.startsWith('integration-runners:')
    )
      ilFail('WORKER_VM_IDENTITY');
    const boot = await this.machines.exec(vm.id, 'cat /proc/sys/kernel/random/boot_id', 5000);
    if (boot.code !== 0 || boot.stdout.trim() !== plan.bootId) ilFail('WORKER_BOOT_CHANGED');
    return vm;
  }
  async preview(raw: z.infer<typeof workerPlanInputSchema>) {
    const input = workerPlanInputSchema.parse(raw),
      who = this.caller();
    await captureOperationCheck()();
    const tool = await this.tool();
    if (input.toolDigest !== tool.digest || input.inputManifestDigest !== ilHash(input.manifest))
      ilFail('WORKER_DIGEST_MISMATCH');
    const seconds = (Date.parse(input.manifest.deadline) - Date.now()) / 1000;
    if (
      seconds <= 0 ||
      seconds > (input.manifest.mode === 'load' ? 60 : input.manifest.mode === 'mock-only' ? 1800 : 600)
    )
      ilFail('WORKER_DEADLINE');
    if (
      input.manifest.mode === 'load' &&
      (input.manifest.environment.target.kind !== 'mock' ||
        input.manifest.scenario.nodes.some((n) => n.bindings.length || n.condition))
    )
      ilFail('LOAD_TARGET_OR_BINDINGS');
    if (input.manifest.mode === 'functional' && input.manifest.maxRequests > 200)
      ilFail('WORKER_REQUEST_BUDGET');
    const vm = this.machines.get(input.ownedVmReceipt.vmId);
    if (
      vm.createdAt !== input.ownedVmReceipt.createdAt ||
      vm.memoryMiB > 2048 ||
      vm.cpus > 2 ||
      input.ownedVmReceipt.cleanup === 'confirmed' ||
      !input.ownedVmReceipt.owner.startsWith('integration-runners:')
    )
      ilFail('WORKER_VM_IDENTITY');
    const config = await this.workspaces().readCommittedConfig(vm.id);
    if (config.directory !== '/workspace/integration-lab' || ilHash(config) !== input.configRevision)
      ilFail('WORKER_CONFIG_CHANGED');
    const ready = await this.machines.exec(
      vm.id,
      'set -eu\nfor tool in python3 cc ip nft useradd groupadd; do command -v "$tool" >/dev/null; done\npython3 -I -S -c "import ssl,http.client,socket,threading"\ncat /proc/sys/kernel/random/boot_id',
      15000,
    );
    if (ready.code !== 0) ilFail('RUNTIME_NOT_PREPARED', '镜像缺少固定工具所需依赖；请显式准备镜像');
    const bootId = z.uuid().parse(ready.stdout.trim().split(/\r?\n/).at(-1));
    const base = {
      ...input,
      ...who,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      state: 'prepared' as const,
      bootId,
    };
    const plan = workerPlanSchema.parse({ ...base, digest: ilHash(base) });
    await this.plans.change((rows) => rows.push(plan));
    return plan;
  }
  private async record(id: string, patch: Partial<PreparedWorkerReceipt>) {
    return this.receipts.change((rows) => {
      const row = rows.find((r) => r.id === id);
      if (!row) ilFail('WORKER_NOT_FOUND');
      Object.assign(row, patch);
      return row;
    });
  }
  async start(
    planId: string,
    digest: string,
    commitIntent: PreparedWorkerHooks['commitIntent'],
    observe: PreparedWorkerHooks['observe'],
  ) {
    const plan = (await this.plans.all()).find((p) => p.id === planId);
    if (!plan || plan.digest !== digest) ilFail('WORKER_PLAN_MISMATCH');
    await this.check(plan);
    const check = captureOperationCheck();
    await check();
    await this.plans.change((rows) => {
      const p = rows.find((p) => p.id === planId)!;
      if (p.state !== 'prepared') ilFail('WORKER_PLAN_CONSUMED');
      p.state = 'started';
    });
    const id = plan.manifest.sessionId,
      vmId = plan.ownedVmReceipt.vmId,
      abort = new AbortController(),
      live = this.machines.live.get(vmId);
    if (!live) ilFail('WORKER_VM_STOPPED');
    const receipt = workerReceiptSchema.parse({
      id,
      planId,
      vm: plan.ownedVmReceipt,
      bootId: plan.bootId,
      pid: null,
      startTicks: null,
      state: 'starting',
      cleanupConfirmed: false,
      error: null,
      dispatched: 0,
      completed: 0,
    });
    await this.receipts.change((rows) => rows.push(receipt));
    const config = projectSchema.parse(await this.workspaces().readCommittedConfig(vmId));
    const worker = '/workspace/integration-lab/worker.py',
      manifest = '/workspace/integration-lab/manifest-' + id + '.json';
    // 固定审核资产传入新建项目目录；不安装任何依赖。 Stage reviewed bytes, never install dependencies.
    const source = await readFile(toolPath, 'utf8');
    if (createHash('sha256').update(source).digest('hex') !== plan.toolDigest)
      ilFail('WORKER_DIGEST_MISMATCH');
    const identity = await new ProjectRunScopes(this.machines).identity(vmId, config, abort.signal);
    const stage = await this.machines.execInput(
      vmId,
      'umask 077\npython3 -I -S -c ' +
        quote(
          "import json,sys,pathlib,os; v=json.load(sys.stdin); root=pathlib.Path('/workspace/integration-lab'); [(p.write_text(text,encoding='utf-8'),os.chmod(p,0o400),os.chown(p,v['uid'],v['gid'])) for p,text in [(root/'worker.py',v['worker']),(root/v['name'],v['manifest'])]]",
        ),
      Buffer.from(
        JSON.stringify({
          worker: source,
          name: 'manifest-' + id + '.json',
          manifest: JSON.stringify(plan.manifest),
          uid: identity.uid,
          gid: identity.gid,
        }),
      ),
      30000,
      abort.signal,
    );
    if (stage.code !== 0) ilFail('WORKER_STAGE_FAILED');
    let buffer = '',
      seenReady = false,
      finished = false,
      outputBytes = 0;
    const active: Active = { abort, live, tail: Promise.resolve(), done: Promise.resolve() };
    this.active.set(id, active);
    const event = async (e: IntegrationWorkerEvent) => {
      if (e.sessionId !== id) ilFail('WORKER_SESSION_MISMATCH');
      if (e.type === 'ready') {
        if (seenReady || e.bootId !== plan.bootId) ilFail('WORKER_IDENTITY_MISMATCH');
        seenReady = true;
        await this.record(id, { pid: e.pid, startTicks: e.startTicks, state: 'running' });
        await observe(e);
        return;
      }
      if (!seenReady) ilFail('WORKER_NOT_READY');
      if (e.type === 'permit' || e.type === 'batch' || e.type === 'heartbeat') {
        await check();
        await this.check(plan);
        abort.signal.throwIfAborted();
        if (ilHash(e.requests) !== e.digest) ilFail('WORKER_REQUEST_DIGEST');
        if (
          (e.type === 'batch' && plan.manifest.mode !== 'load') ||
          (e.type === 'permit' && plan.manifest.mode !== 'functional') ||
          (e.type === 'heartbeat' && !['load', 'mock-only'].includes(plan.manifest.mode))
        )
          ilFail('WORKER_PERMIT_MODE');
        const authorization = await commitIntent(e);
        await check();
        const consumer = this.caller();
        await this.grants.change((rows) => {
          if (
            rows.some(
              (r) =>
                r.sessionId === id &&
                (r.challenge === e.challenge ||
                  (e.type !== 'heartbeat' && r.type === e.type && r.sequence === e.sequence)),
            )
          )
            ilFail('WORKER_PERMIT_REPLAY');
          rows.push({
            id: randomUUID(),
            sessionId: id,
            challenge: e.challenge,
            digest: e.digest,
            intentDigest: authorization.intentDigest,
            ...consumer,
            sequence: e.sequence,
            type: e.type,
            at: new Date().toISOString(),
          });
        });
        if (this.machines.live.get(vmId) !== live) ilFail('WORKER_VM_IDENTITY');
        const packet = {
          sessionId: id,
          challenge: e.challenge,
          digest: e.digest,
          allow: true,
          secretHeaders: authorization.secretHeaders,
        };
        const result = await this.machines.execInput(
          vmId,
          'python3 -I -S ' + quote(worker) + ' control ' + quote(id),
          Buffer.from(JSON.stringify(packet)),
          2000,
          abort.signal,
        );
        if (result.code !== 0) ilFail('WORKER_CONTROL_FAILED');
        return;
      }
      if (e.type === 'finished') {
        finished = true;
        await this.record(id, { dispatched: e.dispatched, completed: e.completed, error: e.error });
      }
      await observe(e);
    };
    const receive = (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > 70 * 1024 ** 2) {
        abort.abort();
        return;
      }
      buffer += chunk;
      if (buffer.length > 8 * 1024 ** 2) {
        abort.abort();
        return;
      }
      let pos;
      while ((pos = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, pos);
        buffer = buffer.slice(pos + 1);
        if (!line.startsWith('SAKURA_INTEGRATION ')) continue;
        active.tail = active.tail
          .then(() => event(workerEventSchema.parse(JSON.parse(line.slice(19)))))
          .catch(async () => {
            abort.abort();
            await this.record(id, { state: 'unknown', error: 'WORKER_PROTOCOL_FAILED' });
          });
      }
    };
    active.done = (async () => {
      try {
        const result = await projectIdentityTask(
          this.machines,
          vmId,
          config,
          { command: 'exec python3 -I -S ' + quote(worker) + ' ' + quote(manifest), environment: {} },
          abort.signal,
          receive,
          Math.max(1000, Date.parse(plan.manifest.deadline) - Date.now() + 3000),
        );
        await active.tail;
        if (result.code !== 0 || !finished) ilFail('WORKER_EXIT_UNCONFIRMED');
        await this.record(id, { state: 'closed', cleanupConfirmed: true });
      } catch {
        await active.tail;
        await this.record(id, {
          state: 'unknown',
          cleanupConfirmed: false,
          error: 'WORKER_EXIT_UNCONFIRMED',
        });
      } finally {
        this.active.delete(id);
      }
    })();
    return receipt;
  }
  private async original(receipt: PreparedWorkerReceipt) {
    workerReceiptSchema.parse(receipt);
    const row = (await this.receipts.all()).find(
      (r) => r.id === receipt.id && r.planId === receipt.planId && ilHash(r.vm) === ilHash(receipt.vm),
    );
    if (!row) ilFail('WORKER_RECEIPT_MISMATCH');
    const plan = (await this.plans.all()).find((p) => p.id === row.planId)!;
    const who = this.caller();
    if (who.consumer !== plan.consumer) ilFail('WORKER_CONSUMER_CHANGED');
    return { row, plan };
  }
  async inspect(receipt: PreparedWorkerReceipt) {
    return (await this.original(receipt)).row;
  }
  async wait(receipt: PreparedWorkerReceipt) {
    await this.original(receipt);
    await this.active.get(receipt.id)?.done;
    return this.inspect(receipt);
  }
  async stop(receipt: PreparedWorkerReceipt) {
    const { row, plan } = await this.original(receipt);
    if (row.cleanupConfirmed) return row;
    const active = this.active.get(row.id);
    await this.check(plan, false);
    if (active && this.machines.live.get(row.vm.vmId) === active.live) {
      active.abort.abort();
      await active.done;
    }
    return this.inspect(receipt);
  }
  async init() {
    await this.receipts.change((rows) => {
      for (const r of rows)
        if (!r.cleanupConfirmed) {
          r.state = 'unknown';
          r.error = 'WORKER_HOST_RESTARTED';
        }
    });
  }
  async close() {
    for (const active of this.active.values()) active.abort.abort();
    await Promise.all([...this.active.values()].map((a) => a.done));
  }
}
