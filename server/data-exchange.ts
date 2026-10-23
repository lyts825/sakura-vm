/** 独立数据交接容器；声明上游缺失，不自动携带原始祖先。 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import type {
  DataExchangeV1,
  DataDatasetsV1,
  DataRuntimeV1,
  DataLineageV1,
} from './service-contracts/data-lab.ts';
import { dataDatasetSchema, dataOutputSchema, type DataScope } from '../shared/contracts/data-common.ts';
import {
  dataImportSchema,
  dataViewSchema,
  type DataImport,
  type DataAction,
  type DataResult,
} from '../shared/contracts/data-services.ts';
import { DataStore, dataHash, type DataAuthorize } from './data-store.ts';
import { datasetDigest } from './data-datasets.ts';
import {
  writeDeliveryZip,
  readDeliveryZip,
  memoryZipEntry,
  artifactZipEntry,
  zipEntryBytes,
  zipEntryHash,
  importZipEntry,
  type DeliveryZipEntry,
} from './delivery-zip-stream.ts';
import { deliveryHash } from './delivery-artifacts.ts';
import { AppError } from '../shared/errors.ts';
import { dataStudySchema as studySchema, type DataStudy } from '../shared/contracts/data-study.ts';
export class DataExchange implements DataExchangeV1 {
  private imports: DataStore<DataImport>;
  private abort = new AbortController();
  private pending = new Set<Promise<DataResult>>();
  private boundedArtifacts(signal?: AbortSignal): DeliveryArtifactsV1 {
    return new Proxy(this.artifacts, {
      get(target, key) {
        const value = Reflect.get(target, key);
        return typeof value === 'function'
          ? (...args: unknown[]) => {
              signal?.throwIfAborted();
              return Reflect.apply(value, target, args);
            }
          : value;
      },
    });
  }
  constructor(
    metadata: PluginMetadata,
    private artifacts: DeliveryArtifactsV1,
    private datasets: DataDatasetsV1,
    private authorize: DataAuthorize,
    private evidenceProviders?: () => { runtime: DataRuntimeV1; lineage: DataLineageV1 } | undefined,
  ) {
    this.imports = new DataStore(metadata, dataImportSchema, authorize);
  }
  async view(scope: DataScope) {
    return dataViewSchema.parse({ imports: await this.imports.list(scope) });
  }
  private async inspect(scope: DataScope, manifestId: string, signal?: AbortSignal) {
    const artifacts = this.boundedArtifacts(signal);
    const archive = await artifacts.get(scope, manifestId);
    if (archive.files.length !== 1) throw new AppError('交接清单必须仅包含一个数据 ZIP', 400);
    const entries = await readDeliveryZip(artifacts, scope, archive.files[0]);
    signal?.throwIfAborted();
    const study = studySchema.parse(
      JSON.parse((await zipEntryBytes(entries.get('study.json'), 16 * 1024 ** 2)).toString('utf8')),
    );
    const { coreDigest, ...core } = study;
    if (dataHash(core) !== coreDigest) throw new AppError('研究资料核心摘要不符', 400);
    if (
      new Set(study.datasets.map((v) => v.dataset.id)).size !== study.datasets.length ||
      new Set(study.executions.map((v) => v.evidence.id)).size !== study.executions.length ||
      new Set(study.executions.map((v) => v.run.id)).size !== study.executions.length
    )
      throw new AppError('研究资料身份重复', 400);
    const expected = new Set(['study.json']),
      digests = new Set<string>();
    for (const item of study.datasets) {
      const d = item.dataset,
        m = item.manifest;
      if (
        deliveryHash(m.files) !== m.digest ||
        digests.has(d.digest) ||
        datasetDigest(d) !== d.digest ||
        m.digest !== d.manifestDigest ||
        m.id !== d.manifestId
      )
        throw new AppError('数据交接身份或摘要不符', 400);
      digests.add(d.digest);
      if (
        new Set(d.files).size !== d.files.length ||
        d.files.some((p) => !m.files.some((f) => f.path === p)) ||
        m.files.filter((f) => d.files.includes(f.path)).reduce((n, f) => n + f.bytes, 0) !== d.bytes
      )
        throw new AppError('数据交接分区清单不完整', 400);
      for (const file of m.files) {
        signal?.throwIfAborted();
        const path = 'datasets/' + d.digest + '/' + file.path;
        if (expected.has(path)) throw new AppError('数据 ZIP 条目重复', 400);
        expected.add(path);
        const entry = entries.get(path);
        if (
          !entry ||
          entry.bytes !== file.bytes ||
          file.blobId !== file.sha256 ||
          (await zipEntryHash(entry)) !== file.sha256
        )
          throw new AppError('数据 ZIP 文件摘要不符', 400);
      }
    }
    const visiting = new Set<string>(),
      visited = new Set<string>();
    const visit = (digest: string) => {
      if (visiting.has(digest)) throw new AppError('数据血缘存在循环', 400);
      if (visited.has(digest)) return;
      const item = study.datasets.find((v) => v.dataset.digest === digest);
      if (!item) return;
      visiting.add(digest);
      for (const parent of item.dataset.parents) visit(parent);
      visiting.delete(digest);
      visited.add(digest);
    };
    for (const item of study.datasets) visit(item.dataset.digest);
    for (const execution of study.executions) {
      const { evidence, run, manifest } = execution;
      if (
        deliveryHash(manifest.files) !== manifest.digest ||
        run.task.inputs.length !== evidence.inputDigests.length ||
        evidence.inputIds.length !== evidence.inputDigests.length ||
        evidence.runId !== run.id ||
        run.state !== 'succeeded' ||
        run.cleanup !== 'confirmed' ||
        run.manifestId !== manifest.id ||
        dataHash(run.task) !== run.definitionDigest ||
        !run.output ||
        run.output.truncated ||
        evidence.inputDigests.some((d) => !digests.has(d))
      )
        throw new AppError('执行回执或输入闭合范围无效', 400);
      for (let i = 0; i < run.task.inputs.length; i++) {
        const input = run.task.inputs[i],
          dataset = study.datasets.find((v) => v.dataset.digest === evidence.inputDigests[i]);
        if (
          !dataset ||
          evidence.inputIds[i] !== dataset.dataset.id ||
          input.manifest.id !== dataset.dataset.manifestId ||
          input.format !== dataset.dataset.format ||
          dataHash(input.parse) !== dataHash(dataset.dataset.parse) ||
          dataHash(input.manifest.files) !== dataHash(dataset.manifest.files) ||
          input.manifest.digest !== dataset.dataset.manifestDigest ||
          dataHash(input.files) !== dataHash(dataset.dataset.files)
        )
          throw new AppError('执行输入与声明的数据版本不符', 400);
      }
      const definition =
        evidence.kind === 'transform' && run.task.kind === 'transform'
          ? { sql: run.task.sql, parameters: run.task.parameters }
          : evidence.kind === 'quality' && run.task.kind === 'quality'
            ? { rules: run.task.rules, sample: run.task.sample }
            : evidence.kind === 'notebook' && run.task.kind === 'notebook'
              ? {
                  notebook: dataHash({ content: run.task.notebook, datasets: evidence.inputDigests }),
                  parameters: run.task.parameters,
                }
              : null;
      if (!definition || dataHash(definition) !== evidence.definitionDigest)
        throw new AppError('执行定义摘要不符', 400);
      const output = run.output;
      const outputDataset = study.datasets.find((v) => v.dataset.id === evidence.outputDatasetId)?.dataset;
      if (
        outputDataset &&
        (!output.table ||
          outputDataset.manifestId !== manifest.id ||
          outputDataset.manifestDigest !== manifest.digest ||
          outputDataset.definitionDigest !== run.definitionDigest ||
          dataHash(outputDataset.parents) !== dataHash(evidence.inputDigests) ||
          dataHash(outputDataset.schema) !== dataHash(output.table.schema) ||
          dataHash(outputDataset.files) !== dataHash(output.table.files) ||
          outputDataset.rows !== output.table.rows ||
          outputDataset.bytes !== output.table.bytes ||
          outputDataset.format !== output.table.format)
      )
        throw new AppError('输出版本与执行结果不一致', 400);
      if (output.table) {
        const names = output.table.files;
        if (
          new Set(names).size !== names.length ||
          names.some((p) => !manifest.files.some((f) => f.path === p)) ||
          manifest.files.filter((f) => names.includes(f.path)).reduce((n, f) => n + f.bytes, 0) !==
            output.table.bytes
        )
          throw new AppError('表格输出引用不完整', 400);
      }
      if (output.notebookFile && !manifest.files.some((f) => f.path === output.notebookFile))
        throw new AppError('Notebook输出文件缺失', 400);
      for (const file of manifest.files) {
        const path = 'executions/' + evidence.id + '/' + file.path;
        if (expected.has(path)) throw new AppError('执行条目重复', 400);
        expected.add(path);
        const entry = entries.get(path);
        if (
          !entry ||
          entry.bytes !== file.bytes ||
          file.blobId !== file.sha256 ||
          (await zipEntryHash(entry)) !== file.sha256
        )
          throw new AppError('执行输出摘要不符', 400);
      }
      const parsedOutput = dataOutputSchema.parse(
        JSON.parse(
          (
            await zipEntryBytes(
              entries.get('executions/' + evidence.id + '/output/result.json'),
              8 * 1024 ** 2,
            )
          ).toString('utf8'),
        ),
      );
      if (dataHash(parsedOutput) !== dataHash(run.output))
        throw new AppError('执行输出回执与文件内容不符', 400);
    }
    if (entries.size !== expected.size || [...entries.keys()].some((k) => !expected.has(k)))
      throw new AppError('数据 ZIP 存在未声明条目', 400);
    if (
      dataHash([...new Set(study.executions.map((e) => e.run.task.environment.digest))].sort()) !==
      dataHash([...study.missingEnvironmentImages].sort())
    )
      throw new AppError('环境镜像缺失声明不符', 400);
    const selectedIds = new Set(study.datasets.map((v) => v.dataset.id));
    const missingOutputs = [
      ...new Set(
        study.executions.flatMap((v) =>
          v.evidence.outputDatasetId && !selectedIds.has(v.evidence.outputDatasetId)
            ? [v.evidence.outputDatasetId]
            : [],
        ),
      ),
    ].sort();
    if (dataHash(missingOutputs) !== dataHash([...study.missingOutputDatasets].sort()))
      throw new AppError('输出版本缺失声明不符', 400);
    const missing = [
      ...new Set(study.datasets.flatMap((v) => v.dataset.parents).filter((d) => !digests.has(d))),
    ].sort();
    if (dataHash(missing) !== dataHash([...study.missingAncestors].sort()))
      throw new AppError('数据起点声明不符', 400);
    return { archive, entries, study };
  }
  async act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult> {
    const active = AbortSignal.any([this.abort.signal, ...(signal ? [signal] : [])]);
    active.throwIfAborted();
    const task = this.operate(scope, input, active);
    this.pending.add(task);
    try {
      return await task;
    } finally {
      this.pending.delete(task);
    }
  }
  private async operate(scope: DataScope, input: DataAction, signal: AbortSignal): Promise<DataResult> {
    await this.authorize(scope);
    const artifacts = this.boundedArtifacts(signal);
    if (input.action === 'export') {
      const datasets = await Promise.all(input.datasetIds.map((id) => this.datasets.get(scope, id)));
      if (new Set(datasets.map((v) => v.digest)).size !== datasets.length)
        throw new AppError('同一版本不能重复导出', 400);
      if (datasets.some((d) => d.sensitivity === 'raw') && !input.allowRaw)
        throw new AppError('原始数据导出需要独立明确授权', 403, 'DATA_EXPORT_RAW');
      const leases: string[] = [];
      try {
        const rows = [];
        const executions: DataStudy['executions'] = [];
        const entries: DeliveryZipEntry[] = [];
        for (const d of datasets) {
          const manifest = await this.artifacts.get(scope, d.manifestId);
          if (manifest.digest !== d.manifestDigest) throw new AppError('数据清单已变化', 409);
          leases.push((await this.artifacts.openRead(scope, manifest.id)).token);
          await this.artifacts.verify(scope, manifest.id);
          rows.push({ dataset: d, manifest });
          for (const file of manifest.files)
            entries.push(artifactZipEntry(artifacts, scope, 'datasets/' + d.digest + '/' + file.path, file));
        }
        const digests = new Set(datasets.map((d) => d.digest));
        if (input.evidenceIds.length) {
          if (!input.allowOutputs)
            throw new AppError('导出执行定义和任意 Notebook 输出需要独立授权', 403, 'DATA_EXPORT_OUTPUTS');
          const providers = this.evidenceProviders?.();
          if (!providers) throw new AppError('导出执行证据需要血缘和运行插件', 409);
          const evidence = (await providers.lineage.view(scope)).evidence;
          for (const id of input.evidenceIds) {
            const item = evidence.find((e) => e.id === id);
            if (
              !item ||
              item.inputDigests.some((d) => !digests.has(d)) ||
              item.inputIds.some((id) => !datasets.some((d) => d.id === id))
            )
              throw new AppError('执行证据的全部输入必须显式包含在所选版本中', 409, 'DATA_EXPORT_INPUTS');
            const run = await providers.runtime.get(scope, item.runId);
            if (
              run.state !== 'succeeded' ||
              run.cleanup !== 'confirmed' ||
              !run.manifestId ||
              !run.output ||
              run.output.truncated
            )
              throw new AppError('执行证据未完整成功', 409);
            const manifest = await this.artifacts.get(scope, run.manifestId);
            leases.push((await this.artifacts.openRead(scope, manifest.id)).token);
            await this.artifacts.verify(scope, manifest.id);
            executions.push({ evidence: item, run, manifest });
            for (const file of manifest.files)
              entries.push(
                artifactZipEntry(artifacts, scope, 'executions/' + item.id + '/' + file.path, file),
              );
          }
        }
        const core = {
          type: 'sakura-data-study-v1',
          schemaVersion: 1,
          signature: 'unsupported',
          datasets: rows,
          executions,
          missingOutputDatasets: [
            ...new Set(
              executions.flatMap((e) =>
                e.evidence.outputDatasetId && !datasets.some((d) => d.id === e.evidence.outputDatasetId)
                  ? [e.evidence.outputDatasetId]
                  : [],
              ),
            ),
          ],
          missingEnvironmentImages: [...new Set(executions.map((e) => e.run.task.environment.digest))],
          missingAncestors: [...new Set(datasets.flatMap((d) => d.parents).filter((d) => !digests.has(d)))],
          reproducibility: 'declared-inputs-and-evidence',
          createdAt: new Date().toISOString(),
        };
        const study = studySchema.parse({ ...core, coreDigest: dataHash(core) });
        const metadata = Buffer.from(JSON.stringify(study));
        if (metadata.length > 16 * 1024 ** 2) throw new AppError('Study 定义元数据超过 16 MiB', 413);
        entries.unshift(memoryZipEntry('study.json', metadata));
        signal?.throwIfAborted();
        const file = await writeDeliveryZip(artifacts, scope, 'data-study.zip', entries),
          manifest = await this.artifacts.seal(scope, {
            kind: 'output',
            label: '数据研究交接',
            files: [file],
          });
        await this.artifacts.retain(scope, manifest.id, 'data:export:' + manifest.id);
        return {
          manifestId: manifest.id,
          message: '已生成未签名的数据交接包；可核验所选数据字节，缺席上游不构成可复现证明',
        };
      } finally {
        for (const token of leases) await this.artifacts.closeRead(scope, token);
      }
    }
    if (input.action === 'inspect-import') {
      const row = await this.imports.get(scope, input.id);
      const lease = await this.artifacts.openRead(scope, row.manifestId);
      try {
        return {
          import: row,
          manifestId: row.manifestId,
          study: (await this.inspect(scope, row.manifestId, signal)).study,
        };
      } finally {
        await this.artifacts.closeRead(scope, lease.token);
      }
    }
    if (input.action === 'import-preview') {
      const lease = await this.artifacts.openRead(scope, input.manifestId);
      try {
        const { archive, study } = await this.inspect(scope, input.manifestId, signal);
        const record = await this.imports.put(scope, {
          id: randomUUID(),
          scope,
          manifestId: archive.id,
          digest: archive.digest,
          state: 'quarantined',
          namespace: '',
          datasetIds: [],
          missingAncestors: study.missingAncestors,
          createdAt: new Date().toISOString(),
        });
        await this.artifacts.retain(scope, archive.id, 'data:import:' + record.id);
        return {
          import: record,
          manifestId: archive.id,
          message: '格式及内容摘要已验证；未认证发布者，需在新命名空间接收',
        };
      } finally {
        await this.artifacts.closeRead(scope, lease.token);
      }
    }
    if (input.action === 'reconcile-import') {
      const row = await this.imports.get(scope, input.id);
      if (row.state !== 'accepting') throw new AppError('没有待核对的接收事务', 409);
      const known = (await this.datasets.view(scope)).datasets;
      const present = row.datasetIds.filter((id) => known.some((d) => d.id === id));
      if (present.length && present.length !== row.datasetIds.length)
        throw new AppError('接收记录不完整，请保留隔离记录', 503, 'DATA_IMPORT_REVIEW');
      const record = (await this.imports.change(scope, (rows) => {
        const current = rows.find((v) => v.id === row.id)!;
        current.state = present.length ? 'accepted' : 'quarantined';
        if (!present.length) {
          current.datasetIds = [];
          current.namespace = '';
        }
        return current;
      })) as DataImport;
      return { import: record };
    }
    if (input.action === 'accept') {
      const record = await this.imports.get(scope, input.id);
      if (record.state !== 'quarantined') throw new AppError('交接记录不能重复接收', 409);
      if (
        (await this.imports.list(scope)).some(
          (r) => ['accepted', 'accepting'].includes(r.state) && r.namespace === input.namespace,
        )
      )
        throw new AppError('接收命名空间已存在', 409);
      const lease = await this.artifacts.openRead(scope, record.manifestId);
      try {
        const { archive, entries, study } = await this.inspect(scope, record.manifestId, signal);
        if (archive.digest !== record.digest) throw new AppError('交接包已变化', 409);
        const acceptedRows: z.infer<typeof dataDatasetSchema>[] = [];
        for (const item of study.datasets) {
          signal?.throwIfAborted();
          const files = [];
          for (const file of item.manifest.files) {
            const path = 'datasets/' + item.dataset.digest + '/' + file.path;
            files.push(await importZipEntry(artifacts, scope, entries.get(path)!, file.path, file.mode));
          }
          const manifest = await this.artifacts.seal(scope, {
            kind: 'import',
            label: input.namespace.slice(0, 160),
            files,
          });
          if (manifest.digest !== item.dataset.manifestDigest)
            throw new AppError('接收清单摘要发生变化', 409);
          acceptedRows.push({
            ...item.dataset,
            id: randomUUID(),
            scope,
            name: (input.namespace + '/' + item.dataset.name).slice(0, 160),
            manifestId: manifest.id,
            archived: false,
          });
        }
        const ids = acceptedRows.map((r) => r.id);
        await this.imports.change(scope, (rows) => {
          const current = rows.find((v) => v.id === record.id)!;
          if (
            current.state !== 'quarantined' ||
            rows.some(
              (v) =>
                v.id !== current.id &&
                ['accepting', 'accepted'].includes(v.state) &&
                v.namespace === input.namespace,
            )
          )
            throw new AppError('接收状态或命名空间冲突', 409);
          current.state = 'accepting';
          current.namespace = input.namespace;
          current.datasetIds = ids;
        });
        await this.datasets.acceptMany(scope, acceptedRows);
        const accepted = (await this.imports.change(scope, (rows) => {
          const current = rows.find((v) => v.id === record.id)!;
          if (current.state !== 'accepting') throw new AppError('交接状态已变化', 409);
          current.state = 'accepted';
          current.namespace = input.namespace;
          current.datasetIds = ids;
          return current;
        })) as DataImport;
        return { import: accepted, message: '已接收为本地数据副本；未授予执行权限或发布者信任' };
      } finally {
        await this.artifacts.closeRead(scope, lease.token);
      }
    }
    throw new AppError('数据交接不支持该动作', 400);
  }
  async close() {
    this.abort.abort();
    await Promise.allSettled([...this.pending]);
    await this.imports.close();
  }
}
