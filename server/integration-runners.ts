/** 固定运行计划、逐请求持久意图和独立 VM 核销。 Frozen plans, durable intents and owned VM cleanup. */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { imageUploadSchema, imageAssetSchema, type ImageUpload } from '../shared/contracts/image-assets.ts';
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { ImageAssetsV1 } from './service-contracts/image-assets.ts';
import type { EgressRulesV1 } from './service-contracts/egress-rules.ts';
import type * as Ports from './service-contracts/integration-lab.ts';
import type { PreparedWorkerSessionsV1 } from './service-contracts/prepared-worker-sessions.ts';
import type { IntegrationMetadataFactory } from './integration-specs.ts';
import { IntegrationRows, ilHash, ilBytes, ilFail, ilSealed, ilIdentity } from './integration-store.ts';
import { bindRequest, compileScenario, pointer } from './integration-validation.ts';
import { captureOperationCheck } from './operation-context.ts';
import { captureResourceContext, withResourceContext } from './host-runtime/context.ts';
import { projectSchema } from './project-config.ts';
import { ProjectRunScopes } from './project-run-scope.ts';
import { Jobs } from './jobs.ts';
import {
  runSchema,
  runPlanSchema,
  runPreviewSchema,
  ilDigest,
  type IntegrationScope,
  type IntegrationRun,
  type IntegrationRunInput,
  type IntegrationRunPlan,
  type IntegrationEvidence,
  type IntegrationRef,
} from '../shared/contracts/integration-lab.ts';
import {
  workerReceiptSchema,
  type PreparedWorkerReceipt,
  type IntegrationWorkerChallenge,
  type IntegrationWorkerManifest,
} from '../shared/contracts/integration-worker.ts';
type Dependencies = {
  specs: Ports.IntegrationSpecsV1;
  scenarios: Ports.IntegrationScenariosV1;
  mocks: Ports.IntegrationMocksV1;
  environments: Ports.IntegrationEnvironmentsV1;
  fixtures: Ports.IntegrationFixturesV1;
  assertions: Ports.IntegrationAssertionsV1;
};
export class IntegrationRunners implements Ports.IntegrationRunnersV1 {
  readonly jobs = new Jobs('integration-runners');
  private runs;
  private planRows;
  private workerRows;
  private imageRows;
  private closed = false;
  private gates: Promise<unknown> = Promise.resolve();
  constructor(
    meta: IntegrationMetadataFactory,
    private d: Dependencies,
    private images: ImageAssetsV1,
    private egress: EgressRulesV1,
    private workers: PreparedWorkerSessionsV1,
    private machines: VmAccess,
    private workspaces: WorkspacesV1,
  ) {
    this.runs = new IntegrationRows(meta('runs'), runSchema);
    this.planRows = new IntegrationRows(meta('plans'), runPlanSchema);
    this.workerRows = new IntegrationRows(meta('workers'), workerReceiptSchema);
    this.imageRows = new IntegrationRows(
      meta('images'),
      z
        .object({
          id: z.uuid(),
          workspaceId: z.uuid(),
          capacityToken: z.uuid(),
          bytes: z.number().int().positive(),
          state: z.enum(['uploading', 'finished', 'discarded']),
          asset: imageAssetSchema.nullable(),
        })
        .strict(),
    );
  }
  async availableImages(scope: IntegrationScope) {
    await this.d.specs.assertWorkspace(scope);
    return this.images.list();
  }
  async beginImage(
    scope: IntegrationScope,
    raw: Pick<ImageUpload, 'digest' | 'bytes' | 'distro' | 'architecture' | 'source'>,
  ) {
    await this.d.specs.assertWorkspace(scope);
    const input = imageUploadSchema
      .pick({ digest: true, bytes: true, distro: true, architecture: true, source: true })
      .parse(raw);
    if (input.bytes > 8 * 1024 ** 3) ilFail('IMAGE_DISK_LIMIT');
    const cap = await this.d.specs.reserveCapacity(scope, {
      objects: 1,
      revisions: 1,
      bytes: input.bytes * 2,
      metadataBytes: 4096,
      controlBytes: 4096,
    });
    const upload = await this.images.begin(input);
    await this.imageRows.change((rows) =>
      rows.push({
        id: upload.id,
        workspaceId: scope.workspaceId,
        capacityToken: cap.token,
        bytes: input.bytes,
        state: 'uploading',
        asset: null,
      }),
    );
    return upload;
  }
  private async imageRecord(scope: IntegrationScope, id: string) {
    await this.d.specs.assertWorkspace(scope);
    const row = (await this.imageRows.all()).find((r) => r.id === id && r.workspaceId === scope.workspaceId);
    if (!row) ilFail('IMAGE_UPLOAD_NOT_FOUND');
    return row;
  }
  async appendImage(scope: IntegrationScope, id: string, offset: number, data: string) {
    const row = await this.imageRecord(scope, id);
    if (row.state !== 'uploading') ilFail('IMAGE_UPLOAD_NOT_ACTIVE');
    return this.images.append(id, offset, data);
  }
  async finishImage(scope: IntegrationScope, id: string) {
    const row = await this.imageRecord(scope, id);
    if (row.asset) return row.asset;
    if (row.state !== 'uploading') ilFail('IMAGE_UPLOAD_NOT_ACTIVE');
    const asset = await this.images.finish(id);
    if (asset.virtualBytes > 8 * 1024 ** 3) ilFail('IMAGE_DISK_LIMIT');
    await this.images.retain(
      { assetId: asset.id, digest: asset.digest },
      'integration-runners:image:' + scope.workspaceId + ':' + id,
    );
    await this.imageRows.change((rows) => {
      const r = rows.find((r) => r.id === id)!;
      r.state = 'finished';
      r.asset = asset;
    });
    await this.d.specs.commitCapacity(scope, row.capacityToken, {
      objects: 1,
      revisions: 1,
      bytes: asset.bytes,
      metadataBytes: 4096,
      controlBytes: 0,
    });
    return asset;
  }
  async imageUploads(scope: IntegrationScope) {
    await this.d.specs.assertWorkspace(scope);
    const ids = new Set(
      (await this.imageRows.all())
        .filter((r) => r.workspaceId === scope.workspaceId && r.state === 'uploading')
        .map((r) => r.id),
    );
    return (await this.images.uploads()).filter((r) => ids.has(r.id));
  }
  async discardImage(scope: IntegrationScope, id: string) {
    const row = await this.imageRecord(scope, id);
    if (row.state === 'finished') ilFail('IMAGE_REFERENCE_PROTECTED');
    if (row.state === 'discarded') return;
    await this.images.discardUpload(id);
    await this.d.specs.releaseCapacity(scope, row.capacityToken);
    await this.imageRows.change((rows) => {
      rows.find((r) => r.id === id)!.state = 'discarded';
    });
  }
  async list(scope: IntegrationScope) {
    await this.d.specs.assertWorkspace(scope);
    return (await this.runs.all()).filter((r) => r.workspaceId === scope.workspaceId);
  }
  async plans(scope: IntegrationScope) {
    await this.d.specs.assertWorkspace(scope);
    return (await this.planRows.all()).filter((r) => r.workspaceId === scope.workspaceId);
  }
  async inspect(scope: IntegrationScope, id: string) {
    const run = (await this.list(scope)).find((r) => r.id === id);
    if (!run) ilFail('RUN_NOT_FOUND');
    return run;
  }
  private async update(id: string, edit: (r: IntegrationRun) => void) {
    return this.runs.change((rows) => {
      const row = rows.find((r) => r.id === id);
      if (!row) ilFail('RUN_NOT_FOUND');
      edit(row);
      return row;
    });
  }
  private async snapshot(scope: IntegrationScope, input: IntegrationRunInput) {
    const scenario = (await ilSealed(this.d.scenarios, scope, input.scenario)).content;
    const contract = (await ilSealed(this.d.specs, scope, scenario.contract)).content;
    const environment = (await ilSealed(this.d.environments, scope, scenario.environment)).content;
    const fixtures = await Promise.all(
      scenario.fixtures.map(async (ref) => (await ilSealed(this.d.fixtures, scope, ref)).content),
    );
    const mock = input.mock ? (await ilSealed(this.d.mocks, scope, input.mock)).content : null;
    const assertions = (await ilSealed(this.d.assertions, scope, input.assertions)).content;
    if (
      ilHash(assertions.scenario) !== ilHash(input.scenario) ||
      (mock && ilHash(mock.contract) !== ilHash(scenario.contract))
    )
      ilFail('RUN_REFERENCE_MISMATCH');
    if ((environment.target.kind === 'mock' && !mock) || (environment.target.kind !== 'mock' && mock))
      ilFail('MOCK_TARGET_MISMATCH');
    if (mock && ilHash(mock.fixtures) !== ilHash(scenario.fixtures)) ilFail('MOCK_FIXTURE_SET_MISMATCH');
    compileScenario(scenario, contract);
    return { scenario, contract, environment, fixtures, mock, assertions };
  }
  async preview(scope: IntegrationScope, raw: IntegrationRunInput) {
    await this.d.specs.assertWorkspace(scope);
    for (const old of await this.plans(scope))
      if (old.state === 'validated' && Date.parse(old.expiresAt) < Date.now()) {
        await this.d.specs.releaseCapacity(scope, old.capacity.token);
        await this.planRows.change((rows) => {
          rows.find((p) => p.id === old.id)!.state = 'invalidated';
        });
        const bytes = ilBytes(old) + 4096;
        await this.d.specs.commitCapacity(scope, old.recordCapacity.token, {
          objects: 1,
          revisions: 1,
          bytes: bytes * 2,
          metadataBytes: bytes,
          controlBytes: 4096,
        });
      }
    const input = runPreviewSchema.parse(raw);
    const snapshot = await this.snapshot(scope, input);
    if (ilBytes(snapshot) > 16 * 1024 ** 2) ilFail('RUN_INPUT_BUDGET');
    if (
      input.mode === 'load' &&
      (snapshot.environment.target.kind !== 'mock' ||
        snapshot.scenario.nodes.some((n) => n.bindings.length || n.condition) ||
        input.durationSeconds > 60)
    )
      ilFail('LOAD_ONLY_FIXED_MOCK');
    if (
      input.mode === 'functional' &&
      (input.requests > 200 || input.durationSeconds > 600 || input.requests < snapshot.scenario.nodes.length)
    )
      ilFail('RUN_BUDGET');
    if (input.mode === 'mock-only' && snapshot.environment.target.kind !== 'mock')
      ilFail('MOCK_TARGET_REQUIRED');
    const asset = await this.images.verify(input.image);
    if (asset.virtualBytes > 8 * 1024 ** 3 || asset.bytes > 8 * 1024 ** 3) ilFail('IMAGE_DISK_LIMIT');
    const tool = await this.workers.tool(),
      versions = await this.d.environments.versions(scope, snapshot.scenario.environment);
    const id = randomUUID(),
      now = Date.now();
    const recordCap = await this.d.specs.reserveCapacity(scope, {
      objects: 2,
      revisions: 2,
      bytes: 192 * 1024 ** 2,
      metadataBytes: 96 * 1024 ** 2,
      controlBytes: 1024 ** 2,
    });
    await this.d.specs.commitCapacity(scope, recordCap.token);
    const capacity = await this.d.specs
      .reserveCapacity(scope, {
        objects: 0,
        revisions: 0,
        bytes: 8 * 1024 ** 3 + asset.bytes * 2 + 64 * 1024 ** 2,
        metadataBytes: 0,
        controlBytes: 0,
      })
      .catch(async (error) => {
        await this.d.specs.releaseCapacity(scope, recordCap.token);
        throw error;
      });
    const base = {
      ...input,
      id,
      workspaceId: scope.workspaceId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 300000).toISOString(),
      deadline: new Date(now + 300000 + input.durationSeconds * 1000).toISOString(),
      state: 'validated' as const,
      runId: null,
      writes: snapshot.scenario.nodes
        .filter((n) => {
          const op = snapshot.contract.operations.find((o) => o.operationId === n.operationId)!;
          return op.effect !== 'read' || !['GET', 'HEAD', 'OPTIONS'].includes(op.method);
        })
        .map((n) => n.id),
      snapshotDigest: ilHash(snapshot),
      toolDigest: tool.digest,
      credentialVersions: versions,
      targetDigest: ilHash(snapshot.environment.target),
      capacity,
      recordCapacity: recordCap,
    };
    const plan = runPlanSchema.parse({ ...base, digest: ilHash(base) });
    await this.planRows.change((rows) => rows.push(plan));
    return plan;
  }
  async apply(scope: IntegrationScope, raw: { planId: string; digest: string; approveWrites: boolean }) {
    const input = z
      .object({ planId: z.uuid(), digest: ilDigest, approveWrites: z.boolean() })
      .strict()
      .parse(raw);
    await this.d.specs.assertWorkspace(scope);
    const work = this.gates.then(async () => {
      const plan = (await this.plans(scope)).find((r) => r.id === input.planId);
      if (!plan || plan.digest !== input.digest) ilFail('PLAN_DIGEST_MISMATCH');
      if (plan.runId) return this.inspect(scope, plan.runId);
      if (this.closed) ilFail('RUNNER_CLOSED');
      if (plan.state !== 'validated' || Date.parse(plan.expiresAt) < Date.now()) ilFail('PLAN_EXPIRED');
      if (plan.writes.length && !input.approveWrites) ilFail('WRITE_APPROVAL_REQUIRED');
      const snapshot = await this.snapshot(scope, plan);
      if (
        ilHash(snapshot) !== plan.snapshotDigest ||
        ilHash(await this.d.environments.versions(scope, snapshot.scenario.environment)) !==
          ilHash(plan.credentialVersions)
      )
        ilFail('PLAN_SOURCE_CHANGED');
      const all = await this.runs.all(),
        active = all.filter((r) => !r.cleanupConfirmed);
      if (active.length >= 2 || active.some((r) => r.workspaceId === scope.workspaceId)) ilFail('VM_QUOTA');
      if (
        snapshot.environment.target.kind === 'private' &&
        active.some((r) => r.plan.targetDigest === plan.targetDigest)
      )
        ilFail('TARGET_BUSY');
      const id = randomUUID(),
        owner = (await this.d.specs.assertWorkspace(scope)).workspace.owner;
      const consumed = { ...plan, state: 'consumed' as const, runId: id };
      const run = runSchema.parse({
        id,
        workspaceId: scope.workspaceId,
        plan: consumed,
        state: 'queued',
        createdAt: new Date().toISOString(),
        finishedAt: null,
        jobKey: 'integration:' + id,
        vm: null,
        workerId: null,
        egressId: null,
        requests: [],
        evaluation: null,
        cleanupConfirmed: false,
        error: null,
        verification: [],
        snapshot,
        load: null,
      });
      await this.runs.change((rows) => rows.push(run));
      await this.planRows.change((rows) => {
        Object.assign(
          rows.find((p) => p.id === plan.id)!,
          consumed,
        );
      });
      await this.d.specs.commitCapacity(scope, plan.capacity.token);
      for (const ref of this.refs(plan, snapshot)) await this.d.specs.reference(scope, ref, 'run:' + id);
      await this.images.retain(plan.image, 'integration-runners:' + id);
      const check = captureOperationCheck();
      this.jobs.start(
        run.jobKey,
        async (_log, signal) =>
          withResourceContext({ actorId: owner }, () => this.execute(run, signal, check)),
        { title: '接口集成验证', action: 'run' },
      );
      return run;
    });
    this.gates = work.catch(() => {});
    return work;
  }
  private refs(plan: IntegrationRunPlan, snapshot: IntegrationRun['snapshot']): IntegrationRef[] {
    return [
      plan.scenario,
      plan.assertions,
      ...(plan.mock ? [plan.mock] : []),
      snapshot.scenario.contract,
      snapshot.scenario.environment,
      ...snapshot.scenario.fixtures,
    ];
  }
  private async execute(run: IntegrationRun, signal: AbortSignal, check: () => Promise<void>) {
    const scope = { workspaceId: run.workspaceId };
    const evidence: IntegrationEvidence[] = [];
    const secretValues = new Set<string>();
    let worker: PreparedWorkerReceipt | undefined;
    let unknown = false;
    let finished = false;
    const owner = 'integration-runners:' + run.id;
    try {
      await check();
      await this.update(run.id, (r) => {
        r.state = 'preparing';
      });
      const receipt = await this.images.createOwnedVm({
        imageRef: run.plan.image,
        owner,
        name: 'integration-' + run.id.slice(0, 8),
        memoryMiB: 1024,
        cpus: 1,
        network: run.snapshot.environment.target.kind === 'mock' ? 'isolated' : 'nat',
        persistent: false,
        lifetimeMinutes: 20,
      });
      run = await this.update(run.id, (r) => {
        r.vm = receipt;
      });
      await this.machines.start(receipt.vmId);
      const bootDeadline = Date.now() + 240000;
      while (this.machines.state(receipt.vmId) === 'starting' && Date.now() < bootDeadline)
        await delay(100, undefined, { signal });
      if (this.machines.state(receipt.vmId) !== 'running') ilFail('VM_START_FAILED');
      run = await this.update(run.id, (value) => {
        value.vmStartedAt = this.machines.live.get(receipt.vmId)!.startedAt;
      });
      const project = projectSchema.parse({
        directory: '/workspace/integration-lab',
        environment: {},
        networkIsolation: 'host',
      });
      await this.workspaces.save(receipt.vmId, project);
      const made = await this.machines.exec(
        receipt.vmId,
        'set -eu\nmkdir -p /workspace\nchmod 755 /workspace\ntest ! -e /workspace/integration-lab\nmkdir -m 700 /workspace/integration-lab',
        30000,
        signal,
      );
      if (made.code !== 0) ilFail('WORKSPACE_PREPARATION_FAILED');
      const identity = await new ProjectRunScopes(this.machines).reserve(receipt.vmId, project, signal);
      const changed = await this.machines.exec(
        receipt.vmId,
        `chown ${identity.uid}:${identity.gid} /workspace/integration-lab`,
        30000,
        signal,
      );
      if (changed.code !== 0) ilFail('WORKSPACE_PREPARATION_FAILED');
      const deadline = new Date(
        Math.min(Date.parse(run.plan.deadline), Date.now() + run.plan.durationSeconds * 1000),
      ).toISOString();
      let destinationGrantDigest = run.plan.targetDigest;
      if (run.snapshot.environment.target.kind === 'private') {
        const target = run.snapshot.environment.target;
        const grant = await this.egress.preview({
          vmId: receipt.vmId,
          owner,
          destinations: [{ address: target.address, protocol: 'tcp', port: target.port }],
          expiresAt: deadline,
        });
        run = await this.update(run.id, (r) => {
          r.egressId = grant.id;
        });
        const applied = await this.egress.apply(grant.id, grant.digest);
        if (applied.state !== 'active') ilFail('EGRESS_NOT_ACTIVE');
        destinationGrantDigest = applied.digest;
      }
      const config = await this.workspaces.readCommittedConfig(receipt.vmId);
      const manifest: IntegrationWorkerManifest = {
        version: 1,
        sessionId: randomUUID(),
        runId: run.id,
        toolId: 'integration-http-v1',
        mode: run.plan.mode,
        deadline,
        maxRequests: run.plan.mode === 'functional' ? run.snapshot.scenario.nodes.length : run.plan.requests,
        rate: run.plan.rate,
        maxBytes: 64 * 1024 ** 2,
        maxConcurrent: 1,
        ...run.snapshot,
        credentialVersions: run.plan.credentialVersions,
        retainFields: run.plan.retainFields,
      };
      delete (manifest as unknown as Record<string, unknown>).assertions;
      const plan = await this.workers.preview({
        ownedVmReceipt: receipt,
        projectId: 'default',
        configRevision: ilHash(config),
        toolId: 'integration-http-v1',
        toolDigest: run.plan.toolDigest,
        manifest,
        inputManifestDigest: ilHash(manifest),
        destinationGrantDigest,
      });
      const authorize = async (challenge: IntegrationWorkerChallenge) => {
        await check();
        signal.throwIfAborted();
        await this.d.specs.assertWorkspace(scope);
        const current = await this.inspect(scope, run.id);
        if (current.state === 'cancelling') ilFail('RUN_CANCELLED');
        if (
          ilHash(await this.d.environments.versions(scope, run.snapshot.scenario.environment)) !==
          ilHash(run.plan.credentialVersions)
        )
          ilFail('SECRET_VERSION_CHANGED');
        if (run.egressId) {
          const e = await this.egress.observe(run.egressId);
          if (e.state !== 'active') ilFail('EGRESS_REVOKED');
        }
        const compiled = compileScenario(run.snapshot.scenario, run.snapshot.contract);
        const expected =
          challenge.type === 'heartbeat'
            ? []
            : challenge.type === 'batch'
              ? Array.from({ length: run.plan.requests }, (_, i) =>
                  bindRequest(
                    run.snapshot.scenario,
                    run.snapshot.contract,
                    compiled.order[i % compiled.order.length],
                    [],
                    run.snapshot.fixtures,
                  ),
                )
              : [
                  bindRequest(
                    run.snapshot.scenario,
                    run.snapshot.contract,
                    compiled.order[challenge.sequence],
                    evidence,
                    run.snapshot.fixtures,
                  ),
                ];
        if (ilHash(expected) !== challenge.digest) ilFail('BINDING_OUT_OF_SCOPE');
        await this.update(run.id, (r) => {
          for (const [ix, request] of expected.entries()) {
            const sequence = challenge.type === 'batch' ? ix : challenge.sequence;
            if (r.requests.some((e) => e.sequence === sequence)) ilFail('REQUEST_ALREADY_PERMITTED');
            r.requests.push({
              node: request.node,
              sequence,
              requestDigest: ilHash(request),
              bodyDigest: request.bodyDigest,
              state: 'intent-durable',
              status: null,
              headers: {},
              bytes: 0,
              responseDigest: null,
              durationMs: 0,
              complete: false,
              error: null,
              dispatchedAt: null,
              selected: {},
            });
          }
        });
        // 第二次持久写入在签发前完成；签发后失联一律保留未知。 Persist intent before the system grant ledger.
        if (expected.length)
          await this.update(run.id, (r) => {
            for (const e of r.requests) if (e.state === 'intent-durable') e.state = 'permitted';
          });
        const secretHeaders = await this.d.environments.resolve(
          scope,
          run.snapshot.scenario.environment,
          run.plan.credentialVersions,
        );
        for (const value of Object.values(secretHeaders)) if (value) secretValues.add(value);
        return {
          intentDigest: ilHash({ runId: run.id, challenge: challenge.challenge, digest: challenge.digest }),
          secretHeaders,
        };
      };
      // 顶层函数保留 broker 的双方存活检查，资源身份固定为当前 owner 与运行器。 Bind callbacks before system handoff.
      const callbackContext = captureResourceContext();
      worker = await this.workers.start(
        plan.id,
        plan.digest,
        (challenge) => withResourceContext(callbackContext, () => authorize(challenge)),
        (event) =>
          withResourceContext(callbackContext, async () => {
            if (event.type === 'result') {
              const e = event.evidence;
              const original = (await this.inspect(scope, run.id)).requests.find(
                (v) => v.sequence === e.sequence,
              );
              if (!original || original.requestDigest !== e.requestDigest) ilFail('RESULT_WITHOUT_INTENT');
              evidence.push(e);
              unknown ||= !e.complete;
              const selected: IntegrationEvidence['selected'] = {};
              for (const field of run.plan.retainFields) {
                const value = pointer(e.body, field);
                const serialized = JSON.stringify(value) ?? '';
                if (value !== undefined && ![...secretValues].some((secret) => serialized.includes(secret)))
                  selected[field] = value as IntegrationEvidence['selected'][string];
              }
              const { body: _body, ...publicEvidence } = e;
              publicEvidence.headers = Object.fromEntries(
                Object.entries(e.headers).filter(
                  ([, value]) => ![...secretValues].some((secret) => value.includes(secret)),
                ),
              );
              await this.update(run.id, (r) => {
                r.requests[r.requests.findIndex((v) => v.sequence === e.sequence)] = {
                  ...publicEvidence,
                  selected,
                };
              });
            } else if (event.type === 'finished') {
              finished = true;
              await this.update(run.id, (r) => {
                if (event.error) r.error = event.error;
                if (run.plan.mode === 'load')
                  for (const request of r.requests)
                    if (request.sequence >= event.dispatched && request.state === 'permitted')
                      request.state = 'not-sent';
                if (run.plan.mode === 'load') {
                  const samples = evidence
                    .filter((e) => e.complete)
                    .map((e) => e.durationMs)
                    .sort((a, b) => a - b);
                  const percentile = (p: number) =>
                    samples.length ? samples[Math.max(0, Math.ceil(p * samples.length) - 1)] : null;
                  const misses = event.intervalsMs.filter((ms) => ms > 2000 / run.plan.rate).length;
                  r.load = {
                    planned: run.plan.requests,
                    initiated: event.dispatched,
                    completed: event.completed,
                    errors: event.dispatched - event.completed,
                    cancelled: 0,
                    uninitiated: run.plan.requests - event.dispatched,
                    unknown: 0,
                    countsComplete: true,
                    intervalsMs: event.intervalsMs,
                    latencyMs: {
                      samples: samples.length,
                      p50: percentile(0.5),
                      p95: percentile(0.95),
                      p99: percentile(0.99),
                    },
                    timeouts: evidence.filter((e) => e.error === 'HTTP_TIMEOUT').length,
                    scheduleMisses: misses,
                    inconclusive: event.dispatched !== run.plan.requests || !!event.error || misses > 0,
                  };
                }
              });
            }
          }),
      );
      await this.workerRows.change((rows) => rows.push(worker!));
      await this.update(run.id, (r) => {
        r.workerId = worker!.id;
        r.state = 'running';
      });
      const abort = () => {
        void this.workers.stop(worker!).catch(() => {});
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        worker = await this.workers.wait(worker);
      } finally {
        signal.removeEventListener('abort', abort);
      }
      await this.update(run.id, (r) => {
        r.state = 'evaluating';
      });
      const evaluation = await this.d.assertions.evaluate(scope, run.id, run.plan.assertions, evidence);
      await this.update(run.id, (r) => {
        r.evaluation = evaluation;
      });
      if (!finished || !worker.cleanupConfirmed) unknown = true;
    } catch (error) {
      await this.update(run.id, (r) => {
        r.error = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'RUN_FAILED';
      });
    } finally {
      await this.update(run.id, (r) => {
        for (const request of r.requests)
          if (request.state === 'permitted' || request.state === 'intent-durable') {
            request.state = 'effect-unknown';
            unknown = true;
          }
        r.state = 'cleanup';
      });
      let clean = true;
      let identityChanged = false;
      if (run.vm && run.vmStartedAt) {
        const live = this.machines.live.get(run.vm.vmId);
        if (live && live.startedAt !== run.vmStartedAt) {
          identityChanged = true;
          clean = false;
        }
      }
      if (worker) {
        try {
          await this.workers.stop(worker);
        } catch (error) {
          identityChanged ||=
            error instanceof Object &&
            'code' in error &&
            ['WORKER_BOOT_CHANGED', 'WORKER_VM_IDENTITY', 'WORKER_CONSUMER_CHANGED'].includes(
              String(error.code),
            );
          clean = false;
        }
      }
      try {
        if (run.egressId) {
          const e = await this.egress.revoke(run.egressId);
          if (e.state !== 'revoked' && e.state !== 'expired') clean = false;
        }
      } catch {
        clean = false;
      }
      try {
        if (run.vm && !identityChanged) {
          const own = await this.images.destroyOwnedVm(run.vm);
          await this.update(run.id, (value) => {
            value.vm = own;
          });
          if (own.cleanup !== 'confirmed') clean = false;
        }
      } catch {
        clean = false;
      }
      // 原 VM 已销毁可证明内部工具和监听停止；出站核销仍需各自证明。 VM destruction proves contained process exit.
      if (clean) {
        await this.images.release(run.plan.image, owner);
        await this.d.specs.releaseCapacity(scope, run.plan.capacity.token);
      }
      const finalRun = await this.update(run.id, (r) => {
        r.cleanupConfirmed = clean;
        r.finishedAt = new Date().toISOString();
        r.state = !clean ? 'cleanup-pending' : unknown ? 'effect-unknown' : 'completed';
        if (signal.aborted && !r.error) r.error = 'RUN_CANCELLED';
        if (r.plan.mode === 'load' && !r.load) {
          const initiated = r.requests.filter((e) => e.dispatchedAt).length;
          const completed = r.requests.filter((e) => e.complete).length;
          const missing = r.requests.filter((e) => e.state === 'effect-unknown' && !e.dispatchedAt).length;
          r.load = {
            planned: r.plan.requests,
            initiated,
            completed,
            errors: initiated - completed,
            cancelled: 0,
            uninitiated: r.plan.requests - initiated - missing,
            unknown: missing,
            countsComplete: false,
            intervalsMs: [],
            latencyMs: { samples: completed, p50: null, p95: null, p99: null },
            timeouts: 0,
            scheduleMisses: 0,
            inconclusive: true,
          };
        }
      });
      const actual = ilBytes(finalRun) + ilBytes(finalRun.plan);
      await this.d.specs.commitCapacity(scope, run.plan.recordCapacity.token, {
        objects: 2,
        revisions: 2,
        bytes: actual * 2,
        metadataBytes: actual,
        controlBytes: clean ? 0 : 1024 ** 2,
      });
    }
  }
  async cancel(scope: IntegrationScope, id: string) {
    const run = await this.inspect(scope, id);
    if (run.cleanupConfirmed) return run;
    await this.update(id, (r) => {
      r.state = 'cancelling';
    });
    this.jobs.cancel(run.jobKey);
    await this.jobs.wait(run.jobKey);
    return this.inspect(scope, id);
  }
  async recover(scope: IntegrationScope, id: string) {
    const run = await this.inspect(scope, id);
    if (this.jobs.view(run.jobKey)?.status === 'running') ilFail('RUN_STILL_ACTIVE');
    if (run.cleanupConfirmed) return run;
    const live = run.vm ? this.machines.live.get(run.vm.vmId) : undefined;
    if (live && run.vmStartedAt && live.startedAt !== run.vmStartedAt) ilFail('WORKER_VM_IDENTITY');
    const owned = run.vm
      ? (await this.images.owned(run.vm.owner)).find((r) => r.token === run.vm!.token)
      : undefined;
    if (run.workerId && owned?.cleanup !== 'confirmed') {
      const receipt = (await this.workerRows.all()).find((row) => row.id === run.workerId);
      if (!receipt) ilFail('WORKER_RECEIPT_MISSING');
      // 原启动身份改变时保留恢复责任，不触碰后来启动的实例。 Never stop a replacement boot.
      await this.workers.stop(receipt);
    }
    let clean = true;
    if (run.egressId)
      try {
        const e = await this.egress.revoke(run.egressId);
        clean = e.state === 'revoked' || e.state === 'expired';
      } catch {
        clean = false;
      }
    if (run.vm)
      try {
        const original = (await this.images.owned(run.vm.owner)).find(
          (r) => r.token === run.vm!.token && r.vmId === run.vm!.vmId && r.createdAt === run.vm!.createdAt,
        );
        if (!original) ilFail('VM_RECEIPT_CHANGED');
        const r = await this.images.destroyOwnedVm(original);
        clean &&= r.cleanup === 'confirmed';
        await this.update(id, (value) => {
          value.vm = r;
        });
      } catch {
        clean = false;
      }
    if (clean) {
      await this.images.release(run.plan.image, 'integration-runners:' + id);
      await this.d.specs.releaseCapacity(scope, run.plan.capacity.token);
    }
    return this.update(id, (r) => {
      r.cleanupConfirmed = clean;
      r.state = clean
        ? r.requests.some((e) => e.state === 'effect-unknown')
          ? 'effect-unknown'
          : 'interrupted'
        : 'cleanup-pending';
    });
  }
  async verifyEffect(
    scope: IntegrationScope,
    id: string,
    evidenceDigest: string,
    conclusion: 'confirmed-applied' | 'confirmed-not-applied' | 'unresolved',
  ) {
    ilDigest.parse(evidenceDigest);
    z.enum(['confirmed-applied', 'confirmed-not-applied', 'unresolved']).parse(conclusion);
    await this.inspect(scope, id);
    const who = await ilIdentity();
    return this.update(id, (r) => {
      r.verification.push({ at: new Date().toISOString(), actor: who.actor, evidenceDigest, conclusion });
    });
  }
  async init() {
    await this.runs.change((rows) => {
      for (const r of rows)
        if (!r.cleanupConfirmed) {
          r.state = 'interrupted';
          r.error = 'HOST_RESTARTED';
          for (const e of r.requests)
            if (e.state === 'permitted' || e.state === 'intent-durable') e.state = 'effect-unknown';
        }
    });
  }
  async close() {
    this.closed = true;
    await this.jobs.close();
    await this.runs.close();
    await this.planRows.close();
    await this.workerRows.close();
    await this.imageRows.close();
  }
}
