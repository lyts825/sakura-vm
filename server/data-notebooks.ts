/** 不可信 Notebook 在专用实例中执行；敏感级别沿输入传播。 */
import { randomUUID, randomInt } from 'node:crypto';
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { ImageAssetsV1 } from './service-contracts/image-assets.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import type { DataNotebooksV1, DataDatasetsV1, DataRuntimeV1 } from './service-contracts/data-lab.ts';
import type { NotebookEnvironmentsV2 } from './service-contracts/data-notebook-sessions.ts';
import {
  dataNotebookSchema,
  dataEvidenceSchema,
  dataTaskSchema,
  type DataNotebook,
  type DataEvidence,
  type DataScope,
} from '../shared/contracts/data-common.ts';
import {
  dataSessionSchema,
  dataViewSchema,
  type DataSession,
  type DataAction,
  type DataResult,
} from '../shared/contracts/data-services.ts';
import { DataStore, dataHash, dataPutBytes, sameDataScope, type DataAuthorize } from './data-store.ts';
import { DataExecutor } from './data-executor.ts';
import { dataInput } from './data-datasets.ts';
import { AppError } from '../shared/errors.ts';
const cell = z
  .object({
    cell_type: z.enum(['code', 'markdown', 'raw']),
    source: z.union([z.string(), z.array(z.string())]),
    metadata: z.record(z.string(), z.unknown()).default({}),
    id: z.string().optional(),
    outputs: z.array(z.unknown()).optional(),
    execution_count: z.number().nullable().optional(),
  })
  .passthrough();
const notebookFile = z
  .object({
    nbformat: z.literal(4),
    nbformat_minor: z.number().int().min(0).max(5),
    metadata: z.record(z.string(), z.unknown()),
    cells: z.array(cell).max(500),
  })
  .strict();
export function normalizeDataNotebook(content: string) {
  let parsed;
  try {
    parsed = notebookFile.parse(JSON.parse(content));
  } catch {
    throw new AppError('需要 nbformat 4 Notebook，最多 500 个单元', 400, 'DATA_NOTEBOOK_FORMAT');
  }
  const clean = {
    ...parsed,
    metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } },
    cells: parsed.cells.map((c) => ({
      cell_type: c.cell_type,
      source: c.source,
      metadata: {},
      ...(c.id ? { id: c.id } : {}),
      ...(c.cell_type === 'code' ? { outputs: [], execution_count: null } : {}),
    })),
  };
  return JSON.stringify(clean);
}
export class DataNotebooks implements DataNotebooksV1 {
  private notebooks: DataStore<DataNotebook>;
  private evidence: DataStore<DataEvidence>;
  private sessions: DataStore<DataSession>;
  private executor: DataExecutor;
  private abort = new AbortController();
  private pending = new Set<Promise<DataResult>>();
  constructor(
    notebookMeta: PluginMetadata,
    evidenceMeta: PluginMetadata,
    sessionMeta: PluginMetadata,
    private artifacts: DeliveryArtifactsV1,
    private runtime: DataRuntimeV1,
    private datasets: DataDatasetsV1,
    private images: ImageAssetsV1,
    machines: VmAccess,
    workspaces: WorkspacesV1,
    private sessionService: () => NotebookEnvironmentsV2,
    private authorize: DataAuthorize,
  ) {
    this.notebooks = new DataStore(notebookMeta, dataNotebookSchema, authorize);
    this.evidence = new DataStore(evidenceMeta, dataEvidenceSchema, authorize);
    this.sessions = new DataStore(sessionMeta, dataSessionSchema, authorize);
    this.executor = new DataExecutor(machines, workspaces, artifacts, images);
  }
  async init() {
    for (const s of await this.sessions.all())
      if (s.state !== 'stopped')
        await this.sessions.change(
          s.scope,
          (rows) => {
            rows.find((v) => v.id === s.id)!.state = 'review';
          },
          true,
        );
  }
  async view(scope: DataScope) {
    return dataViewSchema.parse({
      notebooks: await this.notebooks.list(scope),
      evidence: await this.evidence.list(scope),
      sessions: await this.sessions.list(scope),
    });
  }
  private target(s: DataSession) {
    return {
      receipt: s.receipt,
      projectId: s.projectId,
      sessionId: s.id,
      hostPort: s.hostPort,
      guestPort: s.guestPort,
    };
  }
  private async update(s: DataSession, state: DataSession['state'], receipt = s.receipt) {
    return (await this.sessions.change(
      s.scope,
      (rows) => {
        const row = rows.find((v) => v.id === s.id)!;
        row.state = state;
        row.receipt = receipt;
        return row;
      },
      true,
    )) as DataSession;
  }
  private async stop(s: DataSession) {
    if (s.state === 'stopped') return s;
    await this.update(s, 'stopping');
    try {
      try {
        await this.sessionService().stop(this.target(s));
      } catch {
        /* 销毁原实例也会核销内核和代理；结果由归属回执确认。 */
      }
      const current = (await this.images.owned(s.receipt.owner)).find(
        (r) =>
          r.token === s.receipt.token && r.vmId === s.receipt.vmId && r.createdAt === s.receipt.createdAt,
      );
      if (!current) throw new AppError('Notebook 原实例归属无法核对', 409);
      const closed = await this.images.destroyOwnedVm(current);
      return await this.update(s, 'stopped', closed);
    } catch (error) {
      await this.update(s, 'review');
      throw error;
    }
  }
  async act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult> {
    const task = this.operate(scope, input, signal);
    this.pending.add(task);
    try {
      return await task;
    } finally {
      this.pending.delete(task);
    }
  }
  private async operate(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult> {
    await this.authorize(scope);
    const activeSignal = AbortSignal.any([this.abort.signal, ...(signal ? [signal] : [])]);
    activeSignal.throwIfAborted();
    if (input.action === 'save-notebook') {
      const datasets = await Promise.all(input.datasetIds.map((id) => this.datasets.get(scope, id)));
      if (datasets.some((d) => d.sensitivity === 'raw') && !input.allowRaw)
        throw new AppError('默认仅绑定脱敏副本；选择原始数据需明确授权', 403, 'DATA_RAW_INPUT');
      const content = normalizeDataNotebook(input.content);
      const row: DataNotebook = {
        id: input.id || randomUUID(),
        scope,
        name: input.name,
        revision: input.expectedRevision + 1,
        content,
        digest: dataHash({ content, datasets: datasets.map((d) => d.digest) }),
        datasetIds: input.datasetIds,
        sensitivity: datasets.some((d) => d.sensitivity === 'raw') ? 'raw' : 'redacted',
        createdAt: new Date().toISOString(),
      };
      return {
        notebook: (await this.notebooks.change(scope, (rows) => {
          const old = rows.find((v) => v.id === row.id && sameDataScope(v.scope, scope));
          if ((old?.revision ?? 0) !== input.expectedRevision) throw new AppError('Notebook 修订冲突', 409);
          if (old) Object.assign(old, row);
          else if (rows.some((v) => v.id === row.id)) throw new AppError('Notebook 身份冲突', 409);
          else rows.push(row);
          return row;
        })) as DataNotebook,
      };
    }
    if (input.action === 'execute-notebook' || input.action === 'open-notebook') {
      const nb = await this.notebooks.get(scope, input.id);
      if (nb.sensitivity === 'raw' && !input.allowRaw)
        throw new AppError('原始输入及输出需要明确授权', 403, 'DATA_RAW_INPUT');
      const datasets = await Promise.all(nb.datasetIds.map((id) => this.datasets.get(scope, id))),
        inputs = await Promise.all(datasets.map((d) => dataInput(this.artifacts, scope, d)));
      const task = dataTaskSchema.parse({
        kind: 'notebook',
        environment: input.environment,
        inputs,
        notebook: nb.content,
        parameters: input.action === 'execute-notebook' ? input.parameters : {},
        allowRaw: input.allowRaw,
      });
      if (input.action === 'execute-notebook') {
        const pending = await this.runtime.execute(scope, task);
        const run = await this.runtime.wait(scope, pending.id, activeSignal);
        const evidence = await this.evidence.put(scope, {
          id: randomUUID(),
          scope,
          kind: 'notebook',
          inputIds: datasets.map((d) => d.id),
          inputDigests: datasets.map((d) => d.digest),
          definitionDigest: dataHash({ notebook: nb.digest, parameters: task.parameters }),
          runId: run.id,
          createdAt: new Date().toISOString(),
        });
        return {
          run,
          evidence,
          message:
            nb.sensitivity === 'raw'
              ? '输出继承原始敏感级别，未自动脱敏'
              : '已执行；脱敏输入不保证任意 Python 输出无敏感内容',
        };
      }
      if ((await this.sessions.list(scope)).filter((s) => s.state !== 'stopped').length >= 2)
        throw new AppError('最多同时保留两个 Notebook 会话，请先关闭或核销', 429);
      const id = randomUUID();
      let session: DataSession | undefined;
      try {
        const { space } = await this.executor.createSpace(
          input.environment,
          'data-notebooks:' + id,
          activeSignal,
          async (receipt) => {
            session = await this.sessions.put(scope, {
              id,
              scope,
              receipt,
              projectId: 'default',
              hostPort: randomInt(20000, 55000),
              guestPort: 8888,
              state: 'starting',
              sensitivity: nb.sensitivity,
              notebookId: nb.id,
              createdAt: new Date().toISOString(),
            });
          },
        );
        await this.executor.stageTask(scope, space, task, id, activeSignal);
        const manifest = await dataPutBytes(
          this.artifacts,
          scope,
          'analysis.ipynb',
          Buffer.from(nb.content),
          'source',
        );
        await this.artifacts.retain(scope, manifest.id, 'data:session:' + id);
        await this.executor.stage(space, scope, manifest, activeSignal);
        const files = await dataPutBytes(
          this.artifacts,
          scope,
          'datasets.json',
          Buffer.from(
            JSON.stringify(
              inputs.map((v, i) => ({
                format: v.format,
                files: v.files.map((f) => 'inputs/' + i + '/' + f),
                parse: v.parse,
              })),
            ),
          ),
          'source',
        );
        await this.executor.stage(space, scope, files, activeSignal);
        const editable = await this.executor.command(space, 'chmod 600 analysis.ipynb', 30, activeSignal);
        if (editable.code !== 0) throw new AppError('Notebook 编辑权限准备失败', 409);
        await this.authorize(scope);
        await this.sessionService().start(this.target(session!), activeSignal);
        session = await this.update(session!, 'active');
        return { session, url: (await this.sessionService().link(this.target(session))).url };
      } catch (error) {
        if (session) await this.stop(session);
        throw error;
      }
    }
    if (input.action === 'stop-notebook')
      return { session: await this.stop(await this.sessions.get(scope, input.id)) };
    if (input.action === 'notebook-link') {
      const session = await this.sessions.get(scope, input.id);
      if (session.state !== 'active') throw new AppError('会话未处于可访问状态', 409);
      return { session, url: (await this.sessionService().link(this.target(session))).url };
    }
    throw new AppError('Notebook 不支持该动作', 400);
  }
  async close() {
    this.abort.abort();
    await Promise.allSettled([...this.pending]);
    const errors = [];
    for (const s of await this.sessions.all())
      if (s.state !== 'stopped')
        try {
          await this.stop(s);
        } catch (e) {
          errors.push(e);
        }
    await Promise.all([this.notebooks.close(), this.evidence.close(), this.sessions.close()]);
    if (errors.length) throw new AggregateError(errors, 'Notebook 实例核销未确认');
  }
}
