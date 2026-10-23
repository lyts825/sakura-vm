/** 隔离数据运行、固定环境和准确资源核销。 Isolated data execution and identity-bound cleanup. */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import type { ImageAssetsV1 } from './service-contracts/image-assets.ts';
import type { DataRuntimeV1 } from './service-contracts/data-lab.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { OwnedImageVm } from '../shared/contracts/image-assets.ts';
import {
  dataRunSchema,
  dataTaskSchema,
  dataOutputSchema,
  type DataScope,
  type DataTask,
  type DataRun,
} from '../shared/contracts/data-common.ts';
import {
  dataViewSchema,
  dataPreparationSchema,
  type DataPreparation,
  dataEnvironmentRecordSchema,
  type DataAction,
  type DataResult,
  type DataEnvironmentRecord,
} from '../shared/contracts/data-services.ts';
import { DataStore, dataHash, dataReadBytes, type DataAuthorize, sameDataScope } from './data-store.ts';
import { DataExecutor } from './data-executor.ts';
import { captureOperationCheck } from './operation-context.ts';
import { Jobs } from './jobs.ts';
import { AppError } from '../shared/errors.ts';
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
export class DataRuntime implements DataRuntimeV1 {
  readonly jobs = new Jobs('data-runtime');
  private runs: DataStore<DataRun>;
  private environments: DataStore<DataEnvironmentRecord>;
  private executor: DataExecutor;
  private closed = false;
  private abort = new AbortController();
  private preparing = new Set<Promise<DataEnvironmentRecord>>();
  private preparations: DataStore<DataPreparation>;
  constructor(
    private machines: VmAccess,
    private workspaces: WorkspacesV1,
    private artifacts: DeliveryArtifactsV1,
    private images: ImageAssetsV1,
    runMeta: PluginMetadata,
    envMeta: PluginMetadata,
    private authorize: DataAuthorize,
    preparationMeta: PluginMetadata,
  ) {
    this.preparations = new DataStore(preparationMeta, dataPreparationSchema, authorize);
    this.runs = new DataStore(runMeta, dataRunSchema, authorize);
    this.environments = new DataStore(envMeta, dataEnvironmentRecordSchema, authorize);
    this.executor = new DataExecutor(machines, workspaces, artifacts, images);
  }
  async init() {
    for (const prep of await this.preparations.all())
      if (prep.state === 'preparing')
        await this.preparations.change(
          prep.scope,
          (rows) => {
            const current = rows.find((p) => p.id === prep.id)!;
            current.state = 'interrupted';
            current.cleanup = 'unknown';
            current.error = '环境准备中断，请核销原实例';
          },
          true,
        );
    for (const run of await this.runs.all())
      if (!TERMINAL.has(run.state))
        await this.update(
          run.scope,
          run.id,
          {
            state: 'interrupted',
            cleanup: run.vmId ? 'unknown' : 'confirmed',
            error: '服务重启，原运行需核销',
          },
          true,
        );
  }
  async view(scope: DataScope) {
    return dataViewSchema.parse({
      preparations: await this.preparations.list(scope),
      environments: await this.environments.list(scope),
      runs: await this.runs.list(scope),
    });
  }
  async get(scope: DataScope, id: string) {
    return this.runs.get(scope, id);
  }
  private async update(scope: DataScope, id: string, patch: Partial<DataRun>, recovery = false) {
    return (await this.runs.change(
      scope,
      (rows) => {
        const row = rows.find((r) => r.id === id && sameDataScope(r.scope, scope));
        if (!row) throw new AppError('数据运行不存在', 404);
        Object.assign(row, patch);
        return row;
      },
      recovery,
    )) as DataRun;
  }
  async execute(scope: DataScope, raw: DataTask) {
    await this.authorize(scope);
    if (this.closed) throw new AppError('数据运行服务已关闭', 503);
    const task = dataTaskSchema.parse(raw);
    const check = captureOperationCheck();
    const id = randomUUID();
    const run: DataRun = {
      id,
      scope,
      task,
      definitionDigest: dataHash(task),
      state: 'queued',
      cleanup: 'pending',
      createdAt: new Date().toISOString(),
    };
    await this.images.retain(
      { assetId: task.environment.assetId, digest: task.environment.digest },
      'data-runtime:' + id,
    );
    try {
      await this.runs.change(scope, (all) => {
        if (this.closed) throw new AppError('数据运行服务已关闭', 503);
        if (
          all.filter((v) => !TERMINAL.has(v.state)).length >= 4 ||
          all.filter((v) => sameDataScope(v.scope, scope) && !TERMINAL.has(v.state)).length >= 2
        )
          throw new AppError('数据运行并发已满', 429);
        all.push(run);
        return run;
      });
    } catch (error) {
      await this.images.release(
        { assetId: task.environment.assetId, digest: task.environment.digest },
        'data-runtime:' + id,
      );
      throw error;
    }
    try {
      this.jobs.start(
        id,
        async (log, signal) => {
          let owned: OwnedImageVm | undefined;
          let output: DataRun['output'];
          let manifestId: string | undefined;
          let failure: unknown;
          try {
            await check();
            await this.authorize(scope);
            await this.update(scope, id, { state: 'preparing' });
            const { space } = await this.executor.createSpace(
              task.environment,
              'data-runtime:' + id,
              signal,
              async (receipt) => {
                owned = receipt;
                await this.update(scope, id, {
                  vmId: receipt.vmId,
                  vmCreatedAt: receipt.createdAt,
                  vmToken: receipt.token,
                });
              },
            );
            await this.executor.stageTask(scope, space, task, id, signal);
            await check();
            await this.update(scope, id, { state: 'running' });
            const execution = await this.executor.command(
              space,
              'exec /opt/sakura-data/bin/python -I worker.py',
              task.environment.timeoutSeconds,
              signal,
            );
            if (execution.code !== 0)
              throw new AppError(
                '数据计算失败：' + execution.stderr.slice(0, 256),
                409,
                'DATA_WORKER_FAILED',
              );
            await this.update(scope, id, { state: 'collecting' });
            const manifest = await this.executor.collect(
              space,
              scope,
              ['output'],
              'output',
              '数据计算结果',
              signal,
            );
            if (manifest.files.reduce((n, f) => n + f.bytes, 0) > 256 * 1024 ** 2)
              throw new AppError('数据结果超过 256 MiB', 413);
            manifestId = manifest.id;
            output = dataOutputSchema.parse(
              JSON.parse(
                (
                  await dataReadBytes(this.artifacts, scope, manifest.id, 'output/result.json', 8 * 1024 ** 2)
                ).toString(),
              ),
            );
            await this.artifacts.retain(scope, manifest.id, 'data:run:' + id);
            await check();
            log('数据计算及结果校验完成');
          } catch (error) {
            failure = error;
          } finally {
            let cleanup: DataRun['cleanup'] = 'confirmed';
            if (owned) {
              try {
                const current = (await this.images.owned(owned.owner)).find(
                  (r) =>
                    r.token === owned!.token && r.vmId === owned!.vmId && r.createdAt === owned!.createdAt,
                );
                if (!current) throw new AppError('数据运行原实例归属无法核对', 409);
                await this.images.destroyOwnedVm(current);
              } catch {
                cleanup = 'unknown';
              }
            }
            const state = failure
              ? signal.aborted
                ? 'cancelled'
                : 'failed'
              : cleanup === 'confirmed'
                ? 'succeeded'
                : 'failed';
            await this.update(
              scope,
              id,
              {
                state,
                cleanup,
                ...(manifestId ? { manifestId } : {}),
                ...(output ? { output } : {}),
                ...(failure
                  ? { error: failure instanceof Error ? failure.message.slice(0, 2048) : '数据计算失败' }
                  : cleanup === 'unknown'
                    ? { error: '数据实例清理未确认' }
                    : {}),
                finishedAt: new Date().toISOString(),
              },
              true,
            );
            if (cleanup === 'unknown') throw new AppError('数据实例清理未确认', 503, 'DATA_CLEANUP_UNKNOWN');
            if (failure) throw failure;
          }
        },
        { title: '数据计算', vmId: scope.vmId, projectId: scope.projectId, owner: 'data-runtime' },
      );
    } catch (error) {
      await this.update(
        scope,
        id,
        { state: 'failed', cleanup: 'confirmed', error: '数据运行调度失败' },
        true,
      );
      throw error;
    }
    return run;
  }
  async wait(scope: DataScope, id: string, signal?: AbortSignal) {
    const abort = () => {
      this.jobs.cancel(id);
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) abort();
      await this.jobs.wait(id);
      const run = await this.get(scope, id);
      if (run.state !== 'succeeded' || run.cleanup !== 'confirmed')
        throw new AppError(
          run.error || '数据运行未成功',
          run.cleanup === 'unknown' ? 503 : 409,
          'DATA_RUN_INCOMPLETE',
        );
      return run;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
  async cancel(scope: DataScope, id: string) {
    await this.get(scope, id);
    this.jobs.cancel(id);
    await this.jobs.wait(id);
    return this.get(scope, id);
  }
  async act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult> {
    await this.authorize(scope);
    if (this.closed) throw new AppError('数据运行服务已关闭', 503);
    if (input.action === 'reconcile-preparation') {
      const prep = await this.preparations.get(scope, input.id);
      if (prep.state === 'preparing') throw new AppError('环境仍在准备', 409);
      for (const receipt of await this.images.owned('data-runtime:' + prep.id))
        await this.images.destroyOwnedVm(receipt);
      return {
        preparation: (await this.preparations.change(
          scope,
          (rows) => {
            const current = rows.find((p) => p.id === prep.id)!;
            current.cleanup = 'confirmed';
            return current;
          },
          true,
        )) as DataPreparation,
      };
    }
    if (input.action === 'prepare-builtin') {
      const asset = await this.images.prepareBuiltin(input.distro, input.architecture);
      return {
        environment: await this.prepare(
          scope,
          {
            action: 'prepare-environment',
            name: input.name,
            assetId: asset.id,
            digest: asset.digest,
            allowDownload: input.allowDownload,
          },
          signal,
        ),
      };
    }
    if (input.action === 'execute') return { run: await this.execute(scope, input.task) };
    if (input.action === 'cancel') return { run: await this.cancel(scope, input.id) };
    if (input.action === 'reconcile') {
      const run = await this.get(scope, input.id);
      if (!TERMINAL.has(run.state)) throw new AppError('运行仍在进行', 409);
      for (const receipt of await this.images.owned('data-runtime:' + run.id))
        await this.images.destroyOwnedVm(receipt);
      return { run: await this.update(scope, run.id, { cleanup: 'confirmed' }, true) };
    }
    if (input.action === 'prepare-environment')
      return { environment: await this.prepare(scope, input, signal) };
    throw new AppError('数据环境不支持该动作', 400);
  }
  private async prepare(
    scope: DataScope,
    input: Extract<DataAction, { action: 'prepare-environment' }>,
    external?: AbortSignal,
  ) {
    if (this.closed) throw new AppError('数据运行服务已关闭', 503);
    const signal = AbortSignal.any([this.abort.signal, ...(external ? [external] : [])]);
    const task = this.prepareInner(scope, input, signal);
    this.preparing.add(task);
    try {
      return await task;
    } finally {
      this.preparing.delete(task);
    }
  }
  private async prepareInner(
    scope: DataScope,
    input: Extract<DataAction, { action: 'prepare-environment' }>,
    signal = new AbortController().signal,
  ) {
    await this.authorize(scope);
    const asset = await this.images.verify({ assetId: input.assetId, digest: input.digest });
    const preparation = await this.preparations.put(scope, {
        id: randomUUID(),
        scope,
        name: input.name,
        state: 'preparing',
        cleanup: 'pending',
        createdAt: new Date().toISOString(),
      }),
      owner = 'data-runtime:' + preparation.id;
    let receipt: OwnedImageVm | undefined;
    let environmentId: string | undefined;
    let failure: unknown;
    try {
      signal.throwIfAborted();
      receipt = await this.images.createOwnedVm({
        imageRef: { assetId: asset.id, digest: asset.digest },
        owner,
        name: 'data-env-' + randomUUID().slice(0, 8),
        network: input.allowDownload ? 'nat' : 'isolated',
        memoryMiB: 2048,
        cpus: 2,
        lifetimeMinutes: 45,
      });
      await this.preparations.change(
        scope,
        (rows) => {
          rows.find((p) => p.id === preparation.id)!.receipt = receipt;
        },
        true,
      );
      await this.machines.start(receipt.vmId);
      const deadline = Date.now() + 240000;
      while (this.machines.state(receipt.vmId) === 'starting' && Date.now() < deadline)
        await delay(100, undefined, { signal });
      if (this.machines.state(receipt.vmId) !== 'running') throw new AppError('准备实例启动失败', 409);
      if (input.allowDownload) {
        if (asset.distro === 'alpine')
          throw new AppError(
            '固定 DuckDB 二进制环境首版要求 Debian 或 Ubuntu 镜像',
            409,
            'DATA_IMAGE_UNSUPPORTED',
          );
        const install = await this.machines.exec(
          receipt.vmId,
          'set -eu\nexport DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y python3 python3-venv gcc iproute2 openssl passwd nftables tmux\npython3 -m venv /opt/sakura-data\n/opt/sakura-data/bin/python -m pip install --only-binary=:all: duckdb==1.5.6 nbclient==0.11.0 nbformat==5.10.4 ipykernel==6.30.1 jupyterlab==4.4.10\n/opt/sakura-data/bin/python -m ipykernel install --prefix=/opt/sakura-data --name python3',
          900000,
          signal,
        );
        if (install.code !== 0)
          throw new AppError('显式环境准备失败，未回退源码构建', 409, 'DATA_ENVIRONMENT_PREPARE_FAILED');
      }
      const probe = await this.machines.exec(
        receipt.vmId,
        '/opt/sakura-data/bin/python -I -c \'import duckdb,nbclient,nbformat,ipykernel,json,sys; assert duckdb.__version__=="1.5.6"; print(json.dumps({"python":sys.version.split()[0],"duckdb":duckdb.__version__,"nbclient":nbclient.__version__}))\'',
        30000,
        signal,
      );
      if (probe.code !== 0) throw new AppError('数据环境依赖未准备', 409, 'DATA_ENVIRONMENT_NOT_READY');
      const versions = z.record(z.string(), z.string()).parse(JSON.parse(probe.stdout));
      const clean = await this.machines.exec(
        receipt.vmId,
        'set -eu\nif command -v cloud-init >/dev/null; then cloud-init clean --logs; fi\nif test -d /var/lib/cloud; then find /var/lib/cloud -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; fi',
        30000,
        signal,
      );
      if (clean.code !== 0) throw new AppError('准备环境身份清理失败', 409);
      await this.machines.stop(receipt.vmId);
      const image = await this.images.captureVm(receipt.vmId, receipt.createdAt);
      await this.authorize(scope);
      const record: DataEnvironmentRecord = {
        id: randomUUID(),
        scope,
        name: input.name,
        image,
        versions,
        ready: true,
        createdAt: new Date().toISOString(),
      };
      await this.images.retain({ assetId: image.id, digest: image.digest }, 'data-runtime:' + record.id);
      const saved = await this.environments.put(scope, record);
      environmentId = saved.id;
      return saved;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      let cleanup: DataPreparation['cleanup'] = 'confirmed';
      let cleanupError: unknown;
      if (receipt)
        try {
          const current = (await this.images.owned(owner)).find(
            (v) =>
              v.token === receipt!.token && v.vmId === receipt!.vmId && v.createdAt === receipt!.createdAt,
          );
          if (!current) throw new AppError('环境准备实例身份无法核对', 409);
          await this.images.destroyOwnedVm(current);
        } catch (error) {
          cleanup = 'unknown';
          cleanupError = error;
        }
      await this.preparations.change(
        scope,
        (rows) => {
          const current = rows.find((p) => p.id === preparation.id)!;
          current.state = failure || cleanupError ? 'failed' : 'succeeded';
          current.cleanup = cleanup;
          current.environmentId = environmentId;
          if (failure || cleanupError)
            current.error = (failure instanceof Error ? failure.message : '环境准备或核销失败').slice(
              0,
              2048,
            );
        },
        true,
      );
      if (cleanupError)
        throw new AppError('环境已记录，但准备实例清理尚未确认', 503, 'DATA_PREPARATION_CLEANUP');
    }
  }
  async close() {
    this.closed = true;
    this.abort.abort();
    await Promise.allSettled([...this.preparing]);
    await this.jobs.close();
    await this.preparations.close();
    await this.runs.close();
    await this.environments.close();
  }
}
