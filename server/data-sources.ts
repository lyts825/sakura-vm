/** 固定输入来源；原始内容保持只读。 Capture immutable data sources without modifying originals. */
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import { metadataPath } from './plugin-metadata.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import type { DataSourcesV1 } from './service-contracts/data-lab.ts';
import type { WorkspacesV1, SecretsV1 } from './service-contracts/v1.ts';
import type { VmAccess } from './vm-access.ts';
import { dataSourceSchema, type DataSource, type DataScope } from '../shared/contracts/data-common.ts';
import { dataViewSchema, type DataAction, type DataResult } from '../shared/contracts/data-services.ts';
import {
  deliveryPathSchema,
  type DeliveryManifest,
  type DeliveryFile,
} from '../shared/contracts/delivery-common.ts';
import { DataStore, dataHash, type DataAuthorize } from './data-store.ts';
import { capturePostgres } from './data-postgres.ts';
import { GitProjectTasks } from './git-project-task.ts';
import { quote } from './shell.ts';
import type { DataReadonlyDatabaseV1 } from './service-contracts/data-readonly-database.ts';
import type { DataPg } from '../shared/contracts/data-services.ts';
import { AppError } from '../shared/errors.ts';
const program = String.raw`import os,sys,json,stat,hashlib,base64
p=PAYLOAD
root=os.open(p['root'],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
opened=[root]
try:
 parent=root
 parts=p['path'].split('/')
 if any(x in ['','.','..'] for x in parts): raise ValueError('path')
 for part in parts[:-1]:
  parent=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent);opened.append(parent)
 fd=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent);opened.append(fd)
 before=os.fstat(fd)
 if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or before.st_size>536870912: raise ValueError('file')
 identity=[before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns]
 if p.get('identity') and p['identity']!=identity: raise ValueError('changed')
 if p['action']=='inspect':
  h=hashlib.sha256()
  while True:
   b=os.read(fd,524288)
   if not b:break
   h.update(b)
  after=os.fstat(fd)
  if identity!=[after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns]:raise ValueError('changed')
  print(json.dumps({'identity':identity,'bytes':before.st_size,'sha256':h.hexdigest()}))
 else:
  os.lseek(fd,p['offset'],os.SEEK_SET)
  print(json.dumps({'data':base64.b64encode(os.read(fd,min(131072,before.st_size-p['offset']))).decode()}))
finally:
 for fd in reversed(opened):os.close(fd)`;
export class DataSources implements DataSourcesV1, DataReadonlyDatabaseV1 {
  private records: DataStore<DataSource>;
  private tasks: GitProjectTasks;
  private controller = new AbortController();
  private pending = new Set<Promise<DataSource>>();
  constructor(
    private metadata: PluginMetadata,
    private artifacts: DeliveryArtifactsV1,
    machines: VmAccess,
    private workspaces: WorkspacesV1,
    private secrets: SecretsV1 | undefined,
    private authorize: DataAuthorize,
  ) {
    this.records = new DataStore(metadata, dataSourceSchema, authorize);
    this.tasks = new GitProjectTasks(machines, workspaces);
  }
  async view(scope: DataScope) {
    return dataViewSchema.parse({ sources: await this.records.list(scope) });
  }
  private async save(
    scope: DataScope,
    input: { name: string; format: DataSource['format']; files: string[] },
    manifest: DeliveryManifest,
    origin: DataSource['origin'],
    provenance: Pick<DataSource, 'parseHint' | 'captureDefinitionDigest'> = {},
  ) {
    const actual = await this.artifacts.get(scope, manifest.id);
    if (actual.digest !== manifest.digest) throw new AppError('来源清单不一致', 409);
    await this.artifacts.verify(scope, manifest.id);
    const selected = input.files.map((path) => {
      deliveryPathSchema.parse(path);
      const file = actual.files.find((f) => f.path === path);
      if (!file) throw new AppError('数据分区不存在', 404);
      return file;
    });
    if (new Set(input.files).size !== input.files.length) throw new AppError('数据分区重复', 400);
    const bytes = selected.reduce((n, f) => n + f.bytes, 0);
    if (bytes > 512 * 1024 ** 2) throw new AppError('单个数据版本超过 512 MiB', 413);
    const record: DataSource = {
      id: randomUUID(),
      scope,
      name: input.name,
      manifestId: manifest.id,
      manifestDigest: manifest.digest,
      format: input.format,
      files: input.files,
      origin,
      capturedAt: new Date().toISOString(),
      bytes,
      complete: true,
      ...provenance,
    };
    await this.artifacts.retain(scope, manifest.id, 'data:source:' + record.id);
    return this.records.put(scope, record);
  }
  async captureDatabase(
    scope: DataScope,
    input: { name: string; connection: DataPg },
    external?: AbortSignal,
  ): Promise<DataSource> {
    const work = this.captureDatabaseInner(scope, input, external);
    this.pending.add(work);
    try {
      return await work;
    } finally {
      this.pending.delete(work);
    }
  }
  private async captureDatabaseInner(
    scope: DataScope,
    input: { name: string; connection: DataPg },
    external?: AbortSignal,
  ): Promise<DataSource> {
    this.controller.signal.throwIfAborted();
    await this.authorize(scope);
    if (!this.secrets) throw new AppError('数据库来源需要启用私密配置插件', 409, 'DATA_SECRETS_REQUIRED');
    const signal = AbortSignal.any([this.controller.signal, ...(external ? [external] : [])]);
    const { manifest, parse } = await capturePostgres(
      scope,
      input.connection,
      this.secrets,
      this.artifacts,
      join(dirname(metadataPath(this.metadata)), 'capture'),
      this.authorize,
      signal,
    );
    return this.save(
      scope,
      { name: input.name, format: 'jsonl', files: ['table.jsonl'] },
      manifest,
      'postgres',
      {
        parseHint: parse,
        captureDefinitionDigest: dataHash({
          ...input.connection,
          ca: input.connection.ca ? dataHash(input.connection.ca) : undefined,
        }),
      },
    );
  }
  async act(scope: DataScope, input: DataAction, external?: AbortSignal): Promise<DataResult> {
    await this.authorize(scope);
    const signal = AbortSignal.any([this.controller.signal, ...(external ? [external] : [])]);
    if (input.action === 'credential-version') {
      if (!this.secrets) throw new AppError('请启用私密配置插件', 409);
      return {
        credential: (await this.secrets.references(scope.vmId, { PASSWORD: input.secretRef })).PASSWORD,
      };
    }
    if (input.action === 'capture-upload')
      return {
        source: await this.save(scope, input, await this.artifacts.get(scope, input.manifestId), 'upload'),
      };
    if (input.action === 'capture-postgres')
      return { source: await this.captureDatabase(scope, input, signal) };
    if (input.action === 'capture-project') {
      const files: DeliveryFile[] = [];
      let total = 0;
      await this.workspaces.projects.inScope(scope.vmId, scope.projectId, async () => {
        await this.tasks.withProject(scope.vmId, signal, undefined, async () => {
          const captured = await this.tasks.capture(scope.vmId);
          if (captured.projectId !== scope.projectId) throw new AppError('项目捕获身份变化', 409);
          const call = async (payload: Record<string, unknown>) => {
            const script = program.replace(
              'PAYLOAD',
              `json.loads(base64.b64decode('${Buffer.from(JSON.stringify({ root: captured.project.directory, ...payload })).toString('base64')}'))`,
            );
            const result = await this.tasks.exec(
              scope.vmId,
              '/usr/bin/python3 -I -S -c ' + quote(script),
              120000,
              signal,
            );
            if (result.code !== 0)
              throw new AppError('项目数据读取被拒绝，文件可能已变化或包含链接', 409, 'DATA_SOURCE_CHANGED');
            return JSON.parse(result.stdout) as unknown;
          };
          for (const path of input.paths) {
            deliveryPathSchema.parse(path);
            const proof = z
              .object({
                identity: z.array(z.number()),
                bytes: z.number().int().nonnegative(),
                sha256: z.string().regex(/^[a-f0-9]{64}$/),
              })
              .strict()
              .parse(await call({ action: 'inspect', path }));
            total += proof.bytes;
            if (total > 512 * 1024 ** 2) throw new AppError('数据源超过 512 MiB', 413);
            const upload = await this.artifacts.begin(scope, { sha256: proof.sha256, bytes: proof.bytes });
            let offset = 0;
            while (offset < proof.bytes) {
              await this.authorize(scope);
              const { data } = z
                .object({ data: z.string() })
                .strict()
                .parse(await call({ action: 'read', path, identity: proof.identity, offset }));
              const length = Buffer.from(data, 'base64').length;
              if (!length || length > proof.bytes - offset) throw new AppError('数据分块不完整', 409);
              await this.artifacts.chunk(scope, upload.id, offset, data);
              offset += length;
            }
            const after = z
              .object({ identity: z.array(z.number()), bytes: z.number(), sha256: z.string() })
              .parse(await call({ action: 'inspect', path, identity: proof.identity }));
            if (after.sha256 !== proof.sha256) throw new AppError('数据捕获期间内容变化', 409);
            files.push({ path, ...(await this.artifacts.complete(scope, upload.id)), mode: 0o400 });
          }
        });
      });
      const manifest = await this.artifacts.seal(scope, { kind: 'source', label: input.name, files });
      return {
        source: await this.save(
          scope,
          { name: input.name, format: input.format, files: input.paths },
          manifest,
          'project',
        ),
      };
    }
    throw new AppError('数据来源不支持该动作', 400);
  }
  async close() {
    this.controller.abort();
    await Promise.allSettled([...this.pending]);
    await this.tasks.close();
    await this.records.close();
  }
}
