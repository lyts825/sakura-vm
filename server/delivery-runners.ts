/** 持久交付运行：新实例矩阵、有界并发、不可变输入与原身份回收。 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { DeliveryArtifactsV1, DeliveryInputsV1 } from './service-contracts/delivery-storage.ts';
import type { DeliveryScope, DeliveryDefinition } from '../shared/contracts/delivery-common.ts';
import { deliveryScopeSchema, deliveryCandidateSchema } from '../shared/contracts/delivery-common.ts';
import {
  deliveryRunSchema,
  deliveryRunRequestSchema,
  type DeliveryRun,
  type DeliveryRunRequest,
  type DeliveryCell,
} from '../shared/contracts/delivery-execution.ts';
import { type PluginMetadata } from './plugin-metadata.ts';
import { captureOperationCheck } from './operation-context.ts';
import { assertDeliveryCandidate } from './delivery-candidate.ts';
import { Jobs } from './jobs.ts';
import { DeliveryExecutor, type DeliverySpace } from './delivery-executor.ts';
import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';

/** 验证 DAG，并求局部重跑的依赖与后继闭包。 Validates the DAG and closes partial retries over dependencies and descendants. */
export function deliveryStepOrder(definition: DeliveryDefinition, selected: string[] = []) {
  const byId = new Map(definition.steps.map((step) => [step.id, step]));
  if (byId.size !== definition.steps.length) throw new AppError('交付步骤标识重复', 400);
  const visiting = new Set<string>(),
    done = new Set<string>(),
    ordered: typeof definition.steps = [];
  const visit = (id: string) => {
    if (done.has(id)) return;
    const step = byId.get(id);
    if (!step || visiting.has(id)) throw new AppError('步骤依赖缺失或存在环', 400);
    visiting.add(id);
    for (const parent of step.dependsOn) visit(parent);
    visiting.delete(id);
    done.add(id);
    ordered.push(step);
  };
  for (const step of definition.steps) visit(step.id);
  if (!selected.length) return ordered;
  const included = new Set(selected);
  if (selected.some((id) => !byId.get(id)?.rerunnable)) throw new AppError('局部重跑必须显式声明可重跑', 409);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of definition.steps)
      if (step.dependsOn.some((id) => included.has(id)) && !included.has(step.id)) {
        included.add(step.id);
        changed = true;
      }
  }
  const addParents = (id: string) => {
    for (const parent of byId.get(id)!.dependsOn)
      if (!included.has(parent)) {
        included.add(parent);
        addParents(parent);
      }
  };
  for (const id of [...included]) addParents(id);
  if ([...included].some((id) => !byId.get(id)?.rerunnable))
    throw new AppError('重跑闭包含未授权重复执行的依赖步骤', 409);
  return ordered.filter((step) => included.has(step.id));
}
export class DeliveryRunners {
  readonly jobs = new Jobs('delivery-runners');
  private runs: DeliveryRun[] = [];
  private executor: DeliveryExecutor;
  private saving = Promise.resolve();
  private closed = false;
  private activeCells = 0;
  constructor(
    machines: VmAccess,
    workspaces: WorkspacesV1,
    private artifacts: DeliveryArtifactsV1,
    private inputs: DeliveryInputsV1,
    private metadata: PluginMetadata,
    private authorize: (scope: DeliveryScope) => void | Promise<void> = () => {},
    images?: import('./service-contracts/image-assets.ts').ImageAssetsV1,
  ) {
    this.executor = new DeliveryExecutor(machines, workspaces, artifacts, images);
  }
  /** 恢复持久记录，旧运行必须按原身份核销。 Restores records with interrupted runs requiring identity-bound recovery. */
  async init() {
    const saved = (await this.metadata.read()).value;
    this.runs = z.array(deliveryRunSchema).parse(saved === undefined ? [] : saved);
    for (const run of this.runs)
      if (run.state !== 'finished') {
        run.state = 'finished';
        run.result = 'interrupted';
        run.cleanup = 'unknown';
        for (const cell of run.cells)
          if (cell.state !== 'finished') {
            cell.state = 'finished';
            cell.result = 'interrupted';
            cell.cleanup = cell.vmId || cell.imageOwner ? 'unknown' : 'verified';
          }
      }
    await this.persist();
  }
  private persist() {
    const snapshot = structuredClone(this.runs);
    const next = this.saving.then(async () => {
      await this.metadata.replace(snapshot);
    });
    this.saving = next.catch(() => {});
    return next;
  }
  private own(scope: DeliveryScope, id: string) {
    deliveryScopeSchema.parse(scope);
    const run = this.runs.find(
      (run) => run.id === id && run.scope.vmId === scope.vmId && run.scope.projectId === scope.projectId,
    );
    if (!run) throw new AppError('交付运行不存在', 404);
    return run;
  }
  async list(scope: DeliveryScope) {
    await this.authorize(scope);
    deliveryScopeSchema.parse(scope);
    return structuredClone(
      this.runs.filter((run) => run.scope.vmId === scope.vmId && run.scope.projectId === scope.projectId),
    );
  }
  async get(scope: DeliveryScope, id: string) {
    await this.authorize(scope);
    return structuredClone(this.own(scope, id));
  }
  /** 校验固定输入和候选授权后进入有界执行队列。 Validates immutable inputs and candidate authority before bounded scheduling. */
  async start(scope: DeliveryScope, raw: DeliveryRunRequest): Promise<DeliveryRun> {
    await this.authorize(scope);
    const check = captureOperationCheck();
    if (this.closed) throw new AppError('交付执行服务正在关闭', 503);
    deliveryScopeSchema.parse(scope);
    const input = deliveryRunRequestSchema.parse(raw);
    if (this.runs.filter((run) => run.state !== 'finished').length >= 32)
      throw new AppError('交付等待队列已满', 429);
    const snapshot =
      input.mode === 'build' && input.inputId ? await this.inputs.get(scope, input.inputId) : undefined;
    const candidate =
      input.mode === 'validate-artifact' && input.candidate
        ? assertDeliveryCandidate(scope, input.candidate)
        : undefined;
    if (!snapshot && !candidate) throw new AppError('需要固定输入或接收验证候选', 400);
    if (candidate && (candidate.scope.vmId !== scope.vmId || candidate.scope.projectId !== scope.projectId))
      throw new AppError('候选范围不匹配', 409);
    const manifest = await this.artifacts.get(scope, snapshot?.manifestId || candidate!.manifestId);
    if (
      candidate &&
      !(await this.artifacts.references(scope, manifest.id)).some(
        (reference) =>
          reference === 'candidate:' + candidate.digest ||
          reference === 'accepted-import:' + candidate.digest,
      )
    )
      throw new AppError('交付包仍在隔离区；请先审阅并接受该确切候选', 409);
    if (manifest.digest !== (snapshot?.manifestDigest || candidate!.manifestDigest))
      throw new AppError('输入制品身份不匹配', 409);
    const definition: DeliveryDefinition = snapshot?.definition || {
      name: '接收制品验证',
      source: { mode: 'commit', ref: 'HEAD', paths: [] },
      environment: candidate!.environment,
      steps: [
        {
          id: 'acceptance',
          name: '执行接收契约',
          command:
            'cd ' +
            quote(candidate!.startup.root) +
            ' && ' +
            (candidate!.startup.command || 'test -f index.html'),
          timeoutSeconds: candidate!.startup.timeoutSeconds,
          rerunnable: true,
          dependsOn: [],
        },
      ],
      outputs: [],
      reports: [],
      startup: candidate!.startup,
      matrix: [],
      maxConcurrency: 1,
      requireTests: false,
    };
    if (input.selectedSteps.length && !input.retryOf) throw new AppError('局部重跑必须引用原运行', 400);
    if (input.retryOf) {
      const original = this.own(scope, input.retryOf);
      if (
        original.state !== 'finished' ||
        original.cleanup !== 'verified' ||
        original.inputDigest !== (snapshot?.digest || candidate!.inputDigest)
      )
        throw new AppError('原运行清理未确认或输入不同，不能重放', 409);
    }
    const steps = deliveryStepOrder(definition, input.selectedSteps);
    const run: DeliveryRun = {
      schemaVersion: 1,
      id: randomUUID(),
      scope: structuredClone(scope),
      mode: input.mode,
      inputId: snapshot?.id,
      inputDigest: snapshot?.digest || candidate!.inputDigest,
      candidateDigest: candidate?.digest,
      state: 'queued',
      cleanup: 'not-started',
      environmentVerified: false,
      steps: [],
      outputManifestIds: [],
      reportManifestIds: [],
      cells: (definition.matrix.length
        ? definition.matrix
        : [{ label: 'default', environment: definition.environment }]
      ).map((cell) => ({
        id: randomUUID(),
        ...cell,
        state: 'queued',
        cleanup: 'not-started',
        environmentVerified: false,
        environmentEvidence: '',
        steps: steps.map((step) => ({ id: step.id, state: 'pending', log: '' })),
        outputManifestIds: [],
        reportManifestIds: [],
      })),
      retryOf: input.retryOf,
      selectedSteps: input.selectedSteps,
      createdAt: new Date().toISOString(),
    };
    await this.artifacts.retain(scope, manifest.id, 'run:' + run.id);
    if (this.runs.filter((value) => value.state !== 'finished').length >= 32) {
      await this.artifacts.release(scope, manifest.id, 'run:' + run.id);
      throw new AppError('交付等待队列已满', 429);
    }
    this.runs.push(run);
    await this.persist();
    try {
      const job = this.jobs.start(
        run.id,
        async (log, signal) => {
          let admissionError: unknown;
          try {
            await check();
            await this.authorize(scope);
            run.state = 'preparing';
            run.cleanup = 'pending';
            await this.persist();
            let next = 0;
            const worker = async () => {
              while (next < run.cells.length) {
                const cell = run.cells[next++];
                await this.cell(run, cell, definition, manifest, steps, signal, log, async () => {
                  await check();
                  await this.authorize(scope);
                });
              }
            };
            const workers = await Promise.allSettled(
              Array.from({ length: Math.min(definition.maxConcurrency, run.cells.length) }, worker),
            );
            const failure = workers.find((value) => value.status === 'rejected');
            if (failure?.status === 'rejected') throw failure.reason;
          } catch (error) {
            admissionError = error;
            for (const cell of run.cells)
              if (cell.state !== 'finished') {
                cell.state = 'finished';
                cell.result = signal.aborted ? 'cancelled' : 'failed';
                cell.cleanup = cell.vmId || cell.imageOwner ? 'unknown' : 'verified';
                cell.error = String(error);
              }
          }
          run.state = 'finished';
          run.finishedAt = new Date().toISOString();
          run.steps = run.cells.flatMap((cell) => cell.steps);
          run.outputManifestIds = run.cells.flatMap((cell) => cell.outputManifestIds);
          run.reportManifestIds = run.cells.flatMap((cell) => cell.reportManifestIds);
          run.cleanup = run.cells.every((cell) => cell.cleanup === 'verified') ? 'verified' : 'unknown';
          run.environmentVerified = run.cells.every((cell) => cell.environmentVerified);
          run.result = signal.aborted
            ? 'cancelled'
            : run.cells.every((cell) => cell.result === 'success') && run.cleanup === 'verified'
              ? 'success'
              : 'failed';
          run.exitCode =
            run.result === 'success'
              ? 0
              : (run.cells.find((cell) => cell.exitCode !== undefined && cell.exitCode !== 0)?.exitCode ?? 1);
          await this.persist();
          if (admissionError) throw admissionError;
          if (run.result !== 'success')
            throw new AppError(
              '交付运行未通过，请检查步骤或原资源清理',
              run.cleanup === 'verified' ? 409 : 503,
              run.cleanup === 'verified' ? 'DELIVERY_FAILED' : 'EXECUTION_CLEANUP_PENDING',
            );
        },
        { vmId: scope.vmId, projectId: scope.projectId, title: '项目交付：' + definition.name },
      );
      run.jobId = job.id;
      await this.persist();
    } catch (error) {
      if (run.jobId) {
        this.jobs.cancel(run.id);
        run.cleanup = 'unknown';
      } else {
        run.state = 'finished';
        run.result = 'failed';
        run.cleanup = 'verified';
      }
      await this.persist();
      throw error;
    }
    return structuredClone(run);
  }
  private async cell(
    run: DeliveryRun,
    cell: DeliveryCell,
    definition: DeliveryDefinition,
    manifest: Awaited<ReturnType<DeliveryArtifactsV1['get']>>,
    steps: DeliveryDefinition['steps'],
    signal: AbortSignal,
    log: (text: string) => void,
    check: () => Promise<void>,
  ) {
    let space: DeliverySpace | undefined,
      slot = false;
    try {
      while (this.activeCells >= 4) await delay(100, undefined, { signal });
      signal.throwIfAborted();
      this.activeCells++;
      slot = true;
      await check();
      cell.state = 'preparing';
      cell.cleanup = 'pending';
      if (cell.environment.imageRef) cell.imageOwner = 'delivery-runners:' + run.id + ':' + cell.id;
      await this.persist();
      space = await this.executor.create(
        cell.environment,
        120,
        signal,
        async (vmId, createdAt, receipt) => {
          cell.vmId = vmId;
          cell.vmCreatedAt = createdAt;
          cell.imageReceipt = receipt;
          await this.persist();
        },
        cell.imageOwner,
      );
      await this.executor.stage(space, run.scope, manifest, signal);
      cell.environmentEvidence = await this.executor.environment(space, signal);
      cell.environmentVerified = true;
      run.state = cell.state = 'running';
      await this.persist();
      for (const step of steps) {
        const result = cell.steps.find((value) => value.id === step.id)!;
        if (step.dependsOn.some((id) => cell.steps.find((value) => value.id === id)?.state !== 'passed')) {
          result.state = 'skipped';
          continue;
        }
        result.state = 'running';
        await this.persist();
        const started = Date.now();
        const execution = await this.executor.command(
          space,
          step.command,
          step.timeoutSeconds,
          signal,
          (text) => {
            result.log = (result.log + text).slice(-65536);
            log('[' + cell.label + '/' + step.id + '] ' + text);
          },
        );
        result.durationMs = Date.now() - started;
        result.exitCode = execution.code;
        result.state = execution.code === 0 ? 'passed' : 'failed';
        result.log = (result.log + execution.stdout + execution.stderr).slice(-65536);
        await this.persist();
      }
      run.state = cell.state = 'collecting';
      await this.persist();
      if (definition.outputs.length) {
        const output = await this.executor.collect(
          space,
          run.scope,
          definition.outputs,
          'output',
          definition.name + ' / ' + cell.label,
          signal,
        );
        await this.artifacts.retain(run.scope, output.id, 'run:' + run.id);
        cell.outputManifestIds.push(output.id);
      }
      for (const report of definition.reports) {
        try {
          const output = await this.executor.collect(
            space,
            run.scope,
            [report.path],
            'report',
            report.format + ' / ' + cell.label,
            signal,
          );
          await this.artifacts.retain(run.scope, output.id, 'run:' + run.id);
          cell.reportManifestIds.push(output.id);
        } catch (error) {
          if (report.required) throw error;
          log('可选报告缺失：' + report.path);
        }
      }
      if (run.mode === 'validate-artifact') cell.outputManifestIds.push(manifest.id);
      cell.exitCode = cell.steps.every((step) => step.state === 'passed')
        ? 0
        : (cell.steps.find((step) => step.exitCode)?.exitCode ?? 1);
      cell.result = cell.exitCode === 0 ? 'success' : 'failed';
    } catch (error) {
      cell.result = signal.aborted ? 'cancelled' : 'failed';
      cell.error = String(error);
      log(cell.label + ': ' + String(error));
    } finally {
      cell.cleanup = 'pending';
      try {
        if (cell.imageOwner) {
          const receipts = await this.executor.destroyOwned(cell.imageOwner);
          cell.imageReceipt = receipts.find((r) => r.vmId === cell.vmId) || cell.imageReceipt;
        } else if (cell.vmId && cell.vmCreatedAt) await this.executor.destroy(cell.vmId, cell.vmCreatedAt);
        cell.cleanup = 'verified';
      } catch (error) {
        cell.cleanup = 'unknown';
        cell.error = (cell.error || '') + '\n' + String(error);
      }
      cell.state = 'finished';
      if (slot) this.activeCells--;
      await this.persist();
    }
  }
  /** 取消原任务，清理结果由执行回调确认。 Cancels the original job; its callback verifies cleanup. */
  async cancel(scope: DeliveryScope, id: string) {
    await this.authorize(scope);
    const run = this.own(scope, id);
    if (run.jobId && run.state !== 'finished') await this.jobs.cancel(run.id);
    return this.get(scope, id);
  }
  /** 核销旧运行的原资源后才允许重跑。 Verifies original resources are removed before retry. */
  async recover(scope: DeliveryScope, id: string) {
    await this.authorize(scope);
    const run = this.own(scope, id);
    if (run.state !== 'finished') throw new AppError('请先取消正在执行的运行', 409);
    for (const cell of run.cells)
      if (cell.cleanup !== 'verified') {
        if (cell.imageOwner) {
          const receipts = await this.executor.destroyOwned(cell.imageOwner);
          cell.imageReceipt = receipts.find((r) => r.vmId === cell.vmId) || cell.imageReceipt;
        } else if (cell.vmId && cell.vmCreatedAt) await this.executor.destroy(cell.vmId, cell.vmCreatedAt);
        cell.cleanup = 'verified';
      }
    run.cleanup = 'verified';
    await this.persist();
    return this.get(scope, id);
  }
  async close() {
    this.closed = true;
    await this.jobs.close();
    await this.saving;
  }
}
