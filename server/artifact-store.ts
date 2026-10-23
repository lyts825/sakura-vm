/** 分块制品存储；仅发布完整核验内容，保留引用独立于实例生命周期。
 * Chunked artifacts publish verified bytes and retain references independently of VM lifetime. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, open, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve, parse } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { deliveryDigestSchema, deliveryFileSchema, deliveryManifestSchema, deliveryScopeSchema,
  type DeliveryScope, type DeliveryManifest, type DeliveryFile } from '../shared/contracts/delivery-common.ts';
import { deliveryUploadSchema, type DeliveryCleanupPlan } from '../shared/contracts/delivery-storage.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import { metadataPath, type PluginMetadata } from './plugin-metadata.ts';
import { storageRuntime } from './storage-runtime.ts';

/** 将完整项目范围编码为无分隔歧义的存储键。Encode the complete project scope as an unambiguous storage key. */
const scopeKey = (scope: DeliveryScope) => JSON.stringify([scope.vmId, scope.projectId]);
/** 对既定字段顺序的 JSON 内容计算 SHA-256。Hash JSON content in its defined field order with SHA-256. */
export const artifactHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const blobSchema = z.object({ id: deliveryDigestSchema, sha256: deliveryDigestSchema, bytes: z.number().int().nonnegative(),
  scopes: z.array(z.string()), quarantine: z.string().optional() }).strict();
const stateSchema = z.object({ schemaVersion: z.literal(1), blobs: z.array(blobSchema), uploads: z.array(deliveryUploadSchema),
  manifests: z.array(deliveryManifestSchema), references: z.record(z.string(), z.array(z.string())),
  readLeases: z.array(z.object({ token: z.uuid(), manifestId: z.uuid(), scope: deliveryScopeSchema, expiresAt: z.iso.datetime() }).strict()).default([]),
  retired: z.array(z.object({ blobId: deliveryDigestSchema, sha256: deliveryDigestSchema, bytes: z.number(), scope: deliveryScopeSchema, error: z.string().optional() }).strict()).default([]) }).strict();
type State = z.infer<typeof stateSchema>;
/** 构造首次使用的空状态；不替代未知持久格式。Create initial empty state without replacing unknown persisted formats. */
const empty = (): State => ({ schemaVersion: 1, blobs: [], uploads: [], manifests: [], references: {}, retired: [], readLeases: [] });
const CHUNK = 512 * 1024;

/** 校验跨平台相对路径，拒绝保留名、别名与文件目录重叠。
 * Validate portable relative paths, rejecting reserved names, aliases and overlapping files/directories. */
export function artifactPaths(files: Pick<DeliveryFile, 'path'>[]) {
  const seen = new Set<string>();
  for (const { path } of files) {
    if (path.split('/').length > 32 || path.split('/').some(part => /[<>"|?*\u0000-\u001f:\\]/.test(part) ||
      /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || !part || part === '.' || part === '..'))
      throw new AppError('制品路径不受支持：' + path, 400);
    const key = path.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new AppError('制品包含重复或大小写冲突的路径：' + path, 409);
    seen.add(key);
  }
  for (const key of seen) { const parts = key.split('/'); parts.pop();
    while (parts.length) { if (seen.has(parts.join('/'))) throw new AppError('制品文件与目录路径冲突', 409); parts.pop(); } }
}

export class ArtifactStore implements DeliveryArtifactsV1 {
  private root: string;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private plans = new Map<string, { scope: string; revision: string; ids: string[]; blobs: string[]; uploads: string[]; expires: number }>();
  /** 将内容目录固定在插件元数据旁，并要求每次操作调用项目授权。
   * Anchor content beside plugin metadata and require project authorization for each operation. */
  constructor(private metadata: PluginMetadata, private authorize: (scope: DeliveryScope) => void | Promise<void>, private readonly owner = 'delivery-artifacts') {
    this.root = join(dirname(metadataPath(metadata)), 'artifacts');
  }
  /** 逐级创建或核对存储目录，拒绝链接和非目录路径。
   * Create or check each storage ancestor, rejecting links and non-directory paths. */
  private async safeRoot() {
    const full = resolve(this.root), base = parse(full).root;
    let current = base;
    for (const part of full.slice(base.length).split(/[\\/]/).filter(Boolean)) {
      current = join(current, part);
      try { const item = await lstat(current); if (!item.isDirectory() || item.isSymbolicLink()) throw new AppError('制品存储路径含链接或非目录', 409); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await mkdir(current); }
    }
  }
  /** 读取已验证格式的状态及其元数据修订。Read schema-validated state with its metadata revision. */
  private async state() { const snapshot = await this.metadata.read(); return { value: snapshot.value == null ? empty() : stateSchema.parse(snapshot.value), revision: snapshot.revision }; }
  /** 重检项目授权，以预期修订提交已解析状态。Recheck project authorization and commit parsed state at the expected revision. */
  private async save(value: State, revision: string, scope: DeliveryScope) {
    await this.authorize(scope); await this.metadata.replace(stateSchema.parse(value), { expectedRevision: revision });
  }
  /** 串行化操作，执行前检查关闭、范围授权和存储路径；失败不阻塞后续操作。
   * Serialize operations, checking closure, scope authorization and storage paths; failures do not stall later operations. */
  private run<T>(scope: DeliveryScope, action: () => Promise<T>): Promise<T> {
    scope = deliveryScopeSchema.parse(scope);
    const result = this.queue.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('制品库已关闭', 503);
      await this.authorize(scope); await this.safeRoot(); return action();
    });
    this.queue = result; return result;
  }
  /** 仅从已校验 UUID 或摘要构造本库文件名。Build store filenames only from validated UUIDs or digests. */
  private file(id: string, temporary = false) { return join(this.root, temporary ? 'upload-' + z.uuid().parse(id) : deliveryDigestSchema.parse(id)); }
  /** 返回本项目有权读取且未隔离的内容记录。Return a non-quarantined content record granted to this project. */
  private blob(state: State, scope: DeliveryScope, id: string) {
    const result = state.blobs.find(item => item.id === id && item.scopes.includes(scopeKey(scope)));
    if (!result) throw new AppError('当前项目中不存在此制品内容', 404);
    if (result.quarantine) throw new AppError('制品已隔离：' + result.quarantine, 409);
    return result;
  }
  /** 查找准确项目范围的清单，缺失时报告 404。Find a manifest in the exact project scope or report 404. */
  private manifest(state: State, scope: DeliveryScope, id: string) {
    const result = state.manifests.find(item => item.id === id && scopeKey(item.scope) === scopeKey(scope));
    if (!result) throw new AppError('当前项目中不存在此制品清单', 404); return result;
  }
  /** 合并持久引用和未过期下载保护，仅供清理判断。Combine persistent references and live download leases for cleanup decisions. */
  private retention(state: State, id: string) {
    return [...(state.references[id] || []), ...state.readLeases.filter(lease => lease.manifestId === id && Date.parse(lease.expiresAt) > Date.now())
      .map(lease => 'download:' + lease.token + ' @ ' + lease.expiresAt)];
  }
  /** 核对普通文件身份，以固定内存读取完整 SHA-256，始终关闭句柄。
   * Check ordinary-file identity, read its complete SHA-256 with fixed memory, and always close the handle. */
  private async hashFile(path: string) {
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new AppError('制品文件类型无效', 409);
    const handle = await open(path, 'r');
    try {
      const actual = await handle.stat(); if (actual.ino !== entry.ino || actual.dev !== entry.dev) throw new AppError('制品文件身份已改变', 409);
      const hash = createHash('sha256'), buffer = Buffer.alloc(CHUNK); let offset = 0;
      for (;;) { const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset); if (!bytesRead) break; hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead; }
      return { sha256: hash.digest('hex'), bytes: offset };
    } finally { await handle.close(); }
  }
  /** 返回本项目清单副本，不要求实例存活。Return project manifest copies without requiring a live VM. */
  async list(scope: DeliveryScope) { return this.run(scope, async () => structuredClone((await this.state()).value.manifests.filter(item => scopeKey(item.scope) === scopeKey(scope)))); }
  /** 读取指定清单副本，拒绝跨项目 ID。Read the selected manifest copy, rejecting cross-project IDs. */
  async get(scope: DeliveryScope, id: string) { return this.run(scope, async () => structuredClone(this.manifest((await this.state()).value, scope, id))); }
  /** 在上传配额内独占创建临时文件并登记长度和摘要。
   * Exclusively create a temporary file within the upload quota and record its length and digest. */
  async begin(scope: DeliveryScope, input: { sha256: string; bytes: number }) {
    return this.run(scope, async () => {
      const { value, revision } = await this.state();
      if (value.uploads.filter(item => scopeKey(item.scope) === scopeKey(scope)).length >= 128) throw new AppError('未完成上传已达上限', 409);
      const upload = deliveryUploadSchema.parse({ ...input, id: randomUUID(), scope, offset: 0, createdAt: new Date().toISOString() });
      await storageRuntime.run({ owner: this.owner, taskId: upload.id, label: '准备制品分块上传', paths: [this.root], mode: 'write', buffers: 0, files: 1,
        temporary: [{ path: this.root, bytes: upload.bytes }] }, async () => {
        const handle = await open(this.file(upload.id, true), 'wx', 0o600); await handle.close();
        value.uploads.push(upload); await this.save(value, revision, scope);
      }); return upload;
    });
  }
  /** 核对准确偏移和文件身份，写入并同步有界分块后推进元数据。
   * Check the exact offset and file identity, then write and sync a bounded chunk before advancing metadata. */
  async chunk(scope: DeliveryScope, id: string, offset: number, data: string) {
    return this.run(scope, async () => {
      const { value, revision } = await this.state(), item = value.uploads.find(upload => upload.id === id && scopeKey(upload.scope) === scopeKey(scope));
      if (!item) throw new AppError('上传不存在', 404);
      if (!Number.isSafeInteger(offset) || offset !== item.offset || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data) || data.length > Math.ceil(CHUNK / 3) * 4)
        throw new AppError('上传偏移或分块编码无效', 409);
      const bytes = Buffer.from(data, 'base64'); if (!bytes.length || offset + bytes.length > item.bytes) throw new AppError('上传分块长度无效', 400);
      const path = this.file(id, true), info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== offset) throw new AppError('上传文件状态不确定，保留以供检查', 409);
      await storageRuntime.run({ owner: this.owner, taskId: id, label: '写入制品分块', paths: [path], mode: 'write', buffers: 1, files: 1,
        temporary: [{ path, bytes: item.bytes - offset }] }, async () => {
        const handle = await open(path, 'r+');
        try { const current = await handle.stat(); if (current.ino !== info.ino || current.dev !== info.dev) throw new AppError('上传文件身份已改变', 409);
          let written = 0; while (written < bytes.length) { const result = await handle.write(bytes, written, bytes.length - written, offset + written); written += result.bytesWritten; }
          await handle.sync();
        } finally { await handle.close(); }
        item.offset += bytes.length; await this.save(value, revision, scope);
      }); return { offset: item.offset };
    });
  }
  /** 核验全部上传字节，再授予已有内容访问权或发布新内容；不接管未知文件。
   * Verify all uploaded bytes before granting existing content or publishing new content; never adopt unknown files.
   * 设计思路 / Design：复用内容先保存引用再删临时文件，新的摘要路径只在不存在时发布；
   * reuse saves the content grant before removing the temporary file; new digest paths publish only when absent.
   * 中断后的未知内容保持原样，避免把未确认的状态当作成功。
   * Unknown content after interruption remains untouched rather than being treated as confirmed success. */
  async complete(scope: DeliveryScope, id: string) {
    return this.run(scope, async () => {
      const { value, revision } = await this.state(), item = value.uploads.find(upload => upload.id === id && scopeKey(upload.scope) === scopeKey(scope));
      if (!item) throw new AppError('上传不存在', 404);
      if (item.offset !== item.bytes) throw new AppError('上传未完成', 409);
      return storageRuntime.run({ owner: this.owner, taskId: id, label: '核验完整制品', paths: [this.root], mode: 'write', buffers: 1, files: 1 }, async () => {
        const checked = await this.hashFile(this.file(id, true));
        if (checked.sha256 !== item.sha256 || checked.bytes !== item.bytes) throw new AppError('完整内容摘要不匹配，上传保留待检查', 409);
        const existing = value.blobs.find(blob => blob.id === item.sha256);
        if (existing) {
          const prior = await this.hashFile(this.file(existing.id));
          if (prior.sha256 !== item.sha256 || prior.bytes !== item.bytes || existing.quarantine) throw new AppError('已有同摘要内容未通过核验', 409);
          if (!existing.scopes.includes(scopeKey(scope))) existing.scopes.push(scopeKey(scope));
          // 先保存元数据，临时文件残留可检查。Save metadata first; a leftover temporary file remains inspectable.
        } else {
          if (value.retired.some(blob => blob.blobId === item.sha256)) throw new AppError('同摘要内容仍有待确认的清理记录', 409);
          try { await lstat(this.file(item.sha256)); throw new AppError('存在未登记的同摘要文件，保留原文件供检查', 409); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          await rename(this.file(id, true), this.file(item.sha256)); value.blobs.push({ id: item.sha256, sha256: item.sha256, bytes: item.bytes, scopes: [scopeKey(scope)] });
        }
        value.uploads = value.uploads.filter(upload => upload.id !== id); await this.save(value, revision, scope);
        if (existing) await unlink(this.file(id, true));
        return { blobId: item.sha256, sha256: item.sha256, bytes: item.bytes };
      });
    });
  }
  /** 在项目授权及存储预算内读取至多 512 KiB，返回准确下一偏移和 EOF。
   * Read at most 512 KiB within project authorization and storage budgets, returning the exact next offset and EOF. */
  async read(scope: DeliveryScope, id: string, offset: number, length: number) {
    return this.run(scope, async () => {
      const { value } = await this.state(), blob = this.blob(value, scope, id);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > blob.bytes || !Number.isSafeInteger(length) || length < 1 || length > CHUNK) throw new AppError('读取范围无效', 400);
      return storageRuntime.run({ owner: this.owner, taskId: randomUUID(), label: '读取制品分块', paths: [this.root], mode: 'read', buffers: 1, files: 1 }, async () => {
        const path = this.file(id), info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== blob.bytes) throw new AppError('制品内容状态异常', 409);
        const handle = await open(path, 'r');
        try { const current = await handle.stat(); if (current.ino !== info.ino || current.dev !== info.dev) throw new AppError('制品身份变化', 409);
          const buffer = Buffer.alloc(Math.min(length, blob.bytes - offset)); const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
          if (bytesRead !== buffer.length) throw new AppError('制品内容被截断', 409);
          return { data: buffer.toString('base64'), offset: offset + bytesRead, eof: offset + bytesRead === blob.bytes, sha256: blob.sha256 };
        } finally { await handle.close(); }
      });
    });
  }
  /** 为指定清单保存十五分钟绝对期限的下载保护，不赋予业务接收状态。
   * Persist a fifteen-minute absolute download lease for the manifest without granting business acceptance. */
  async openRead(scope: DeliveryScope, id: string) {
    return this.run(scope, async () => {
      const { value, revision } = await this.state(); this.manifest(value, scope, id);
      value.readLeases = value.readLeases.filter(lease => Date.parse(lease.expiresAt) > Date.now());
      if (value.readLeases.filter(lease => scopeKey(lease.scope) === scopeKey(scope)).length >= 128) throw new AppError('项目下载租约达到上限', 429);
      const lease = { token: randomUUID(), manifestId: id, scope, expiresAt: new Date(Date.now() + 15 * 60000).toISOString() };
      value.readLeases.push(lease); await this.save(value, revision, scope); return { token: lease.token, expiresAt: lease.expiresAt };
    });
  }
  /** 幂等释放准确项目的下载令牌，不影响其他项目租约。
   * Idempotently release the download token in the exact project without affecting other scopes. */
  async closeRead(scope: DeliveryScope, token: string) {
    return this.run(scope, async () => {
      z.uuid().parse(token); const { value, revision } = await this.state();
      value.readLeases = value.readLeases.filter(lease => lease.token !== token || scopeKey(lease.scope) !== scopeKey(scope));
      await this.save(value, revision, scope); return { closed: true as const };
    });
  }
  /** 校验完整路径和内容记录，将排序文件清单及摘要持久化。
   * Validate complete paths and content records, then persist the sorted file manifest and digest. */
  async seal(scope: DeliveryScope, input: { label: string; kind: DeliveryManifest['kind']; files: DeliveryFile[] }) {
    return this.run(scope, async () => {
      const files = z.array(deliveryFileSchema).max(10000).parse(input.files).sort((a, b) => a.path.localeCompare(b.path, 'en'));
      artifactPaths(files); const { value, revision } = await this.state();
      for (const file of files) { const blob = this.blob(value, scope, file.blobId); if (blob.sha256 !== file.sha256 || blob.bytes !== file.bytes) throw new AppError('清单与制品内容不一致', 409); }
      const manifest = deliveryManifestSchema.parse({ ...input, files, scope, id: randomUUID(), digest: artifactHash(files), createdAt: new Date().toISOString() });
      value.manifests.push(manifest); await this.save(value, revision, scope); return manifest;
    });
  }
  /** 为清单添加去重的持久业务引用，调用方负责后续释放。
   * Add a deduplicated persistent business reference; its caller owns later release. */
  async retain(scope: DeliveryScope, id: string, reference: string) {
    await this.run(scope, async () => { reference = z.string().min(1).max(256).parse(reference); const { value, revision } = await this.state(); this.manifest(value, scope, id);
      const refs = value.references[id] ||= []; if (!refs.includes(reference)) refs.push(reference); await this.save(value, revision, scope); });
  }
  /** 读取业务引用副本，不混入临时下载保护。Read a copy of business references without temporary download protection. */
  async references(scope: DeliveryScope, id: string) {
    return this.run(scope, async () => { const { value } = await this.state(); this.manifest(value, scope, id); return [...(value.references[id] || [])]; });
  }
  /** 移除指定引用，内容仅可由后续已审阅清理删除。
   * Remove the selected reference; content remains until later reviewed cleanup. */
  async release(scope: DeliveryScope, id: string, reference: string) {
    await this.run(scope, async () => { const { value, revision } = await this.state(); this.manifest(value, scope, id);
      value.references[id] = (value.references[id] || []).filter(ref => ref !== reference); await this.save(value, revision, scope); });
  }
  /** 流式复核清单全部内容；发现损坏时持久隔离并报告失败。
   * Stream-verify all manifest content; persist quarantine and report failure when corruption is found. */
  async verify(scope: DeliveryScope, id: string) {
    return this.run(scope, async () => {
      const { value, revision } = await this.state(), manifest = this.manifest(value, scope, id);
      if (artifactHash(manifest.files) !== manifest.digest) throw new AppError('制品清单摘要损坏', 409);
      for (const file of manifest.files) { const blob = this.blob(value, scope, file.blobId);
        try {
          const checked = await storageRuntime.run({ owner: this.owner, taskId: randomUUID(), label: '核验制品摘要', paths: [this.root], mode: 'read', buffers: 1, files: 1 }, () => this.hashFile(this.file(blob.id)));
          if (checked.sha256 !== file.sha256 || checked.bytes !== file.bytes) throw new Error('内容摘要或长度不符');
        } catch (error) { blob.quarantine = error instanceof Error ? error.message : '内容核验失败'; await this.save(value, revision, scope); throw new AppError('制品内容已隔离：' + blob.quarantine, 409); }
      } return { verified: true as const, digest: manifest.digest };
    });
  }
  /** 生成绑定当前修订和五分钟期限的一次性计划，显示引用、上传及未确认清理。
   * Prepare a single-use plan bound to the current revision and five-minute deadline, exposing references, uploads and pending cleanup. */
  async cleanupPlan(scope: DeliveryScope): Promise<DeliveryCleanupPlan> {
    return this.run(scope, async () => {
      const { value, revision } = await this.state(), all = value.manifests.filter(item => scopeKey(item.scope) === scopeKey(scope));
      const manifests = all.filter(item => !this.retention(value, item.id).length), ids = new Set(manifests.map(item => item.id));
      const kept = new Set(value.manifests.filter(item => !ids.has(item.id)).flatMap(item => item.files.map(file => file.blobId)));
      const keptInScope = new Set(all.filter(item => !ids.has(item.id)).flatMap(item => item.files.map(file => file.blobId)));
      const orphaned = value.blobs.filter(blob => !keptInScope.has(blob.id) && blob.scopes.includes(scopeKey(scope)) && !blob.quarantine);
      const uploads = value.uploads.filter(item => scopeKey(item.scope) === scopeKey(scope));
      const retired = value.retired.filter(item => scopeKey(item.scope) === scopeKey(scope));
      const bytes = orphaned.filter(blob => !kept.has(blob.id) && blob.scopes.every(key => key === scopeKey(scope))).reduce((sum, blob) => sum + blob.bytes, 0) + uploads.reduce((sum, item) => sum + item.offset, 0) + retired.reduce((sum, item) => sum + item.bytes, 0);
      const token = randomUUID(), expires = Date.now() + 300000;
      for (const [id, plan] of this.plans) if (plan.expires <= Date.now()) this.plans.delete(id);
      if (this.plans.size >= 128) throw new AppError('清理预览数量已达上限', 429);
      this.plans.set(token, { scope: scopeKey(scope), revision, ids: [...ids], blobs: orphaned.map(blob => blob.id), uploads: uploads.map(item => item.id), expires });
      return { token, revision, expiresAt: new Date(expires).toISOString(), manifests, uploads, unreferencedBlobs: orphaned.map(blob => blob.id),
        pendingCleanup: retired.map(({ blobId, bytes, error }) => ({ blobId, bytes, ...(error ? { error } : {}) })),
        protected: all.filter(item => this.retention(value, item.id).length).map(item => ({ manifestId: item.id, references: this.retention(value, item.id) })), bytes };
    });
  }
  /** 消费有效计划，释放本项目未引用内容并核对物理删除，失败保留准确记录。
   * Consume a valid plan, retire this project's unreferenced content, and verify physical deletion while retaining exact failure records.
   * 设计思路 / Design：先核销令牌与重检修订，再持久化退役身份，最后删除核验匹配的文件；
   * consume the token and recheck revision before persisting retirement identities and deleting verified matching files.
   * 其他项目引用及未过期下载租约继续保护内容，删除失败须重新预览后重试。
   * Other projects and live leases keep content protected; failed deletion requires a new preview before retry. */
  async cleanup(scope: DeliveryScope, token: string) {
    return this.run(scope, async () => {
      const plan = this.plans.get(token); this.plans.delete(token);
      if (!plan || plan.scope !== scopeKey(scope) || plan.expires <= Date.now()) throw new AppError('清理计划已过期或使用', 409);
      const { value, revision } = await this.state(); if (revision !== plan.revision) throw new AppError('制品引用已变化，请重新预览', 409);
      const ids = new Set(plan.ids), selected = value.manifests.filter(item => ids.has(item.id));
      if (selected.some(item => this.retention(value, item.id).length)) throw new AppError('清理对象仍被引用', 409);
      value.manifests = value.manifests.filter(item => !ids.has(item.id)); for (const id of ids) delete value.references[id];
      const kept = new Set(value.manifests.flatMap(item => item.files.map(file => file.blobId)));
      const keptInScope = new Set(value.manifests.filter(item => scopeKey(item.scope) === scopeKey(scope)).flatMap(item => item.files.map(file => file.blobId)));
      for (const blob of value.blobs) if (plan.blobs.includes(blob.id) && !keptInScope.has(blob.id) && !blob.quarantine)
        blob.scopes = blob.scopes.filter(key => key !== scopeKey(scope));
      const blobs = value.blobs.filter(blob => plan.blobs.includes(blob.id) && !kept.has(blob.id) && !blob.scopes.length && !blob.quarantine);
      // 先保存退役身份，中断后可重新预览重试。Persist retirement identities so interrupted deletion can be reviewed and retried.
      value.blobs = value.blobs.filter(blob => !blobs.includes(blob));
      value.retired.push(...blobs.map(blob => ({ blobId: blob.id, sha256: blob.sha256, bytes: blob.bytes, scope })));
      await this.save(value, revision, scope);
      let bytes = 0, deleted = 0;
      for (const blob of value.retired.filter(item => scopeKey(item.scope) === scopeKey(scope))) {
        const current = await this.state(), path = this.file(blob.blobId);
        try {
          const checked = await this.hashFile(path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
          if (checked && (checked.sha256 !== blob.sha256 || checked.bytes !== blob.bytes)) throw new AppError('待清理内容变化，保留文件供检查', 409);
          await this.authorize(scope); if (checked) await unlink(path);
          current.value.retired = current.value.retired.filter(item => item.blobId !== blob.blobId);
          await this.save(current.value, current.revision, scope); bytes += blob.bytes; deleted++;
        } catch (error) {
          const latest = await this.state(), pending = latest.value.retired.find(item => item.blobId === blob.blobId);
          if (pending) { pending.error = error instanceof Error ? error.message : '清理未确认'; await this.save(latest.value, latest.revision, scope); }
          throw error;
        }
      }
      for (const id of plan.uploads) {
        const current = await this.state(), upload = current.value.uploads.find(item => item.id === id);
        if (!upload) continue;
        const path = this.file(id, true), info = await lstat(path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
        if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== upload.offset)) throw new AppError('上传清理身份不确定，保留原记录', 409);
        await this.authorize(scope); if (info) await unlink(path);
        current.value.uploads = current.value.uploads.filter(item => item.id !== id);
        await this.save(current.value, current.revision, scope); bytes += upload.offset;
      }
      return { manifests: selected.length, blobs: deleted, bytes };
    });
  }
  /** 停止准入并等待队列完成，丢弃内存清理计划。Stop admission, drain the queue, and discard in-memory cleanup plans. */
  async close() { this.closed = true; await this.queue.catch(() => {}); this.plans.clear(); }
}
