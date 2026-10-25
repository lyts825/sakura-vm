/** 独立领域拥有的分块材料库；路径只由服务端 UUID 构造。 */
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, lstat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { metadataPath, type PluginMetadata } from './plugin-metadata.ts';
import { storageRuntime } from './storage-runtime.ts';
import { captureOperationCheck } from './operation-context.ts';
import { SuiteRoot, suiteActor, suiteBinding, suiteFail, type SuiteAuthorize } from './suite-store.ts';
import * as S from '../shared/contracts/suite-common.ts';

const chunkLimit = 512 * 1024;
const ledgerSchema = z
  .object({
    uploads: z.array(S.suiteUpload).max(10000),
    leases: z.array(S.suiteReadLease).max(1000).default([]),
  })
  .strict();
const uploadKey = S.suiteScope.extend({ id: S.suiteId }).strict();
export class SuiteMaterials extends SuiteRoot implements S.SuiteMaterialsV1 {
  private directory: string;
  private uploadTail: Promise<unknown> = Promise.resolve();
  private readers = new Map<string, number>();
  constructor(
    domain: string,
    metadata: PluginMetadata,
    private uploadMetadata: PluginMetadata,
    authorize: SuiteAuthorize,
    total: number,
    private maximumFile: number,
    private formats: readonly string[],
    root?: S.SuiteWorkspacePortV1,
  ) {
    super(domain, metadata, authorize, total);
    this.directory = join(dirname(metadataPath(metadata)), 'materials');
    this.root = root;
  }
  private get issuer() {
    return 'material-owner:' + this.domain;
  }
  async policy(input: S.SuitePin) {
    const pin = S.suitePin.parse(input),
      row = await super.get(pin);
    if (row.kind !== 'source') suiteFail('SUITE_SOURCE_REQUIRED');
    const policy = (await this.readState()).policies.find(
      (p) => p.id === row.id && p.workspaceId === row.workspaceId,
    );
    if (!policy) suiteFail('SUITE_SOURCE_PERMISSION');
    return { allowRead: policy.allowRead, allowExport: policy.allowExport, revision: policy.revision };
  }
  protected override async reserveFor(
    input: Parameters<S.SuiteWorkspacePortV1['reserve']>[0],
    consumer: string,
  ) {
    return this.root ? this.root.reserve(input) : super.reserveFor(input, consumer);
  }
  protected override async settleFor(
    input: Parameters<S.SuiteWorkspacePortV1['settle']>[0],
    consumer: string,
  ) {
    return this.root ? this.root.settle(input) : super.settleFor(input, consumer);
  }
  override async get(input: S.SuitePin): Promise<S.SuiteRecord> {
    const row = await super.get(input);
    if (row.kind === 'source') {
      const policy = (await this.readState()).policies.find(
        (p) => p.id === row.id && p.workspaceId === row.workspaceId,
      );
      if (!policy?.allowRead) suiteFail('SUITE_SOURCE_PERMISSION', '材料读取许可已撤销', 403);
    }
    return row;
  }
  private async io<T>(
    file: string,
    bytes: number,
    mode: 'read' | 'write',
    work: () => Promise<T>,
  ): Promise<T> {
    return storageRuntime.run(
      {
        owner: this.domain,
        taskId: randomUUID(),
        label: 'fixed-material',
        paths: [file],
        mode,
        buffers: Math.min(bytes, chunkLimit),
        files: 1,
        ...(mode === 'write' ? { temporary: [{ path: file, bytes }] } : {}),
      },
      async () => {
        await this.access();
        const result = await work();
        await this.access();
        return result;
      },
    );
  }
  private file(id: string) {
    return join(this.directory, S.suiteId.parse(id) + '.blob');
  }
  private async ledger() {
    await this.access();
    const state = ledgerSchema.parse((await this.uploadMetadata.read()).value ?? { uploads: [] });
    await this.access();
    return state;
  }
  private changeUploads<T>(
    scope: S.SuiteScope,
    work: (rows: S.SuiteUpload[], leases: S.SuiteReadLease[]) => T | Promise<T>,
    recheck?: () => Promise<void>,
  ): Promise<T> {
    const check = captureOperationCheck();
    const pending = this.uploadTail.then(async () => {
      await this.access(scope);
      const snapshot = await this.uploadMetadata.read();
      const state = ledgerSchema.parse(snapshot.value ?? { uploads: [] }),
        result = await work(state.uploads, state.leases);
      if (state.uploads.length > 2000) {
        const retained = new Set(
          state.uploads
            .filter((u) => u.state === 'discarded')
            .slice(-1000)
            .map((u) => u.id),
        );
        state.uploads = state.uploads.filter((u) => u.state !== 'discarded' || retained.has(u.id));
      }
      if (Buffer.byteLength(JSON.stringify(state, null, 2)) > 8 * 1024 ** 2)
        suiteFail('SUITE_UPLOAD_LEDGER_FULL');
      const beforeCommit = async () => {
        await check();
        await this.access(scope);
        await recheck?.();
      };
      await beforeCommit();
      await this.uploadMetadata.replace(ledgerSchema.parse(state), {
        expectedRevision: snapshot.revision,
        beforeCommit,
      });
      return structuredClone(result);
    });
    this.uploadTail = pending.catch(() => {});
    return pending;
  }
  async uploads(raw: S.SuiteScope): Promise<S.SuiteUpload[]> {
    const scope = S.suiteScope.parse(raw);
    await this.access(scope);
    return (await this.ledger()).uploads.filter(
      (u) => u.workspaceId === scope.workspaceId && u.actor === suiteActor(),
    );
  }
  async openRead(raw: S.SuitePin & { purpose?: 'read' | 'export' }): Promise<S.SuiteReadLease> {
    const input = S.suitePin
        .extend({ purpose: z.enum(['read', 'export']).default('read') })
        .strict()
        .parse(raw),
      scope = { workspaceId: input.workspaceId };
    const policy = await this.policy({ ...scope, id: input.id, revision: input.revision });
    const workspacePolicyRevision = await this.currentWorkspaceRevision(scope);
    const recheck = async () => {
      const source = await this.get({ ...scope, id: input.id, revision: input.revision }),
        current = await this.policy({ ...scope, id: input.id, revision: input.revision });
      if (
        source.kind !== 'source' ||
        source.state !== 'sealed' ||
        !current.allowRead ||
        (input.purpose === 'export' && !current.allowExport) ||
        current.revision !== policy.revision ||
        (await this.currentWorkspaceRevision(scope)) !== workspacePolicyRevision
      )
        suiteFail('SUITE_SOURCE_PERMISSION');
    };
    await recheck();
    return this.changeUploads(
      scope,
      (_rows, leases) => {
        const now = Date.now();
        for (let i = leases.length - 1; i >= 0; i--)
          if (leases[i].state === 'released' || Date.parse(leases[i].expiresAt) <= now) leases.splice(i, 1);
        if (leases.length >= 1000) suiteFail('SUITE_READ_LEASE_LIMIT');
        const lease: S.SuiteReadLease = {
          id: randomUUID(),
          workspaceId: input.workspaceId,
          actor: suiteActor(),
          binding: suiteBinding(),
          reference: { domain: this.domain, id: input.id, revision: input.revision },
          purpose: input.purpose,
          policyRevision: policy.revision,
          workspacePolicyRevision,
          expiresAt: new Date(now + 900000).toISOString(),
          state: 'active',
        };
        leases.push(lease);
        return lease;
      },
      recheck,
    );
  }
  private async readHandle(raw: S.SuiteScope & { id: string }) {
    const input = uploadKey.parse(raw),
      scope = { workspaceId: input.workspaceId };
    await this.access(scope);
    const lease = (await this.ledger()).leases.find(
      (l) =>
        l.id === input.id &&
        l.workspaceId === input.workspaceId &&
        l.actor === suiteActor() &&
        l.binding === suiteBinding(),
    );
    return lease ?? suiteFail('SUITE_READ_LEASE_DENIED', '原读取租约不可用', 403);
  }
  private async currentWorkspaceRevision(scope: S.SuiteScope) {
    return (await (this.root ? this.root.workspace(scope) : super.workspace(scope))).policyRevision;
  }
  async readLease(raw: S.SuiteScope & { id: string; offset: number; length: number }) {
    const input = uploadKey
        .extend({ offset: z.number().int().min(0), length: z.number().int().positive().max(chunkLimit) })
        .strict()
        .parse(raw),
      lease = await this.readHandle({ workspaceId: input.workspaceId, id: input.id });
    if (lease.state !== 'active' || Date.parse(lease.expiresAt) <= Date.now())
      suiteFail('SUITE_READ_LEASE_EXPIRED');
    const policy = await this.policy({
      workspaceId: input.workspaceId,
      id: lease.reference.id,
      revision: lease.reference.revision,
    });
    if (
      policy.revision !== lease.policyRevision ||
      (await this.currentWorkspaceRevision({ workspaceId: input.workspaceId })) !==
        lease.workspacePolicyRevision
    )
      suiteFail('SUITE_SOURCE_PERMISSION');
    const result = await this.readSource({
      workspaceId: input.workspaceId,
      id: lease.reference.id,
      revision: lease.reference.revision,
      purpose: lease.purpose,
      offset: input.offset,
      length: input.length,
    });
    const current = await this.readHandle({ workspaceId: input.workspaceId, id: input.id });
    if (current.state !== 'active' || Date.parse(current.expiresAt) <= Date.now())
      suiteFail('SUITE_READ_LEASE_EXPIRED');
    const finalPolicy = await this.policy({
      workspaceId: input.workspaceId,
      id: lease.reference.id,
      revision: lease.reference.revision,
    });
    if (
      finalPolicy.revision !== lease.policyRevision ||
      (await this.currentWorkspaceRevision({ workspaceId: input.workspaceId })) !==
        lease.workspacePolicyRevision
    )
      suiteFail('SUITE_SOURCE_PERMISSION');
    return result;
  }
  async closeRead(raw: S.SuiteScope & { id: string }): Promise<S.SuiteReadLease> {
    const input = uploadKey.parse(raw);
    await this.readHandle(input);
    return this.changeUploads({ workspaceId: input.workspaceId }, (_rows, leases) => {
      const lease = leases.find((l) => l.id === input.id)!;
      lease.state = 'released';
      return lease;
    });
  }
  private async assertNotReading(scope: S.SuiteScope, ref: S.SuiteRef) {
    if (
      (await this.ledger()).leases.some(
        (l) =>
          l.workspaceId === scope.workspaceId &&
          l.reference.id === ref.id &&
          l.reference.revision === ref.revision &&
          l.state === 'active' &&
          Date.parse(l.expiresAt) > Date.now(),
      )
    )
      suiteFail('SUITE_MATERIAL_READ_ACTIVE', '材料仍有未释放的读取租约');
  }
  override async previewCleanup(raw: S.SuiteScope & { references: S.SuiteRef[] }) {
    const input = S.suiteScope
      .extend({ references: z.array(S.suiteRef).min(1).max(50) })
      .strict()
      .parse(raw);
    await this.access({ workspaceId: input.workspaceId });
    for (const ref of input.references) await this.assertNotReading({ workspaceId: input.workspaceId }, ref);
    return super.previewCleanup(input);
  }
  async beginUpload(raw: z.input<typeof S.suiteUploadInput>): Promise<S.SuiteUpload> {
    return this.beginDerivedUpload(raw, []);
  }
  /** 派生材料在首次发布字节时建立来源保护，不能先产生可绕过来源许可的裸字节。 */
  protected async beginDerivedUpload(raw: z.input<typeof S.suiteUploadInput>, lineage: S.SuiteRef[]): Promise<S.SuiteUpload> {
    const input = S.suiteUploadInput.parse(raw),
      scope = { workspaceId: input.workspaceId };
    const references = z.array(S.suiteRef).max(1000).parse(lineage);
    for (const reference of references) await this.fixed(scope, reference);
    await this.access(scope);
    if (input.bytes > this.maximumFile || !this.formats.includes(input.format))
      suiteFail('SUITE_MATERIAL_UNSUPPORTED', '文件格式或大小不受支持', 413);
    if (!!input.sourceId !== !!input.expectedRevision) suiteFail('SUITE_REVISION_CONFLICT');
    if (input.sourceId) await this.get({ ...scope, id: input.sourceId, revision: input.expectedRevision! });
    const ticket = await this.reserveFor({ ...scope, bytes: input.bytes, kind: 'material' }, this.issuer);
    const id = randomUUID(),
      file = this.file(id);
    const upload: S.SuiteUpload = {
      ...input,
      lineage: references,
      id,
      actor: suiteActor(),
      offset: 0,
      state: 'uploading',
      reservationId: ticket.id,
      source: null,
      identity: null,
      createdAt: new Date().toISOString(),
    };
    await this.changeUploads(scope, (rows) => {
      if (rows.length >= 10000) suiteFail('SUITE_UPLOAD_LIMIT');
      rows.push(upload);
      return upload;
    });
    const identity = await this.io(file, input.bytes, 'write', async () => {
      await this.access(scope);
      await mkdir(this.directory, { recursive: true });
      const handle = await open(file, 'wx', 0o600);
      try {
        const info = await handle.stat();
        return {
          ino: String(info.ino),
          dev: String(info.dev),
          bytes: info.size,
          mtimeMs: info.mtimeMs,
          ctimeMs: info.ctimeMs,
        };
      } finally {
        await handle.close();
      }
    });
    return this.changeUploads(scope, (rows) => {
      const row = this.requireUpload(rows, scope, id);
      row.identity = identity;
      return row;
    });
  }
  private requireUpload(rows: S.SuiteUpload[], scope: S.SuiteScope, id: string): S.SuiteUpload {
    const row = rows.find(
      (u) => u.id === id && u.workspaceId === scope.workspaceId && u.actor === suiteActor(),
    );
    return row ?? suiteFail('SUITE_UPLOAD_NOT_FOUND', '上传不存在', 404);
  }
  private async regular(file: string) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) suiteFail('SUITE_MATERIAL_IDENTITY');
    return info;
  }
  async appendUpload(
    raw: S.SuiteScope & { id: string; offset: number; data: string },
  ): Promise<S.SuiteUpload> {
    const input = uploadKey
      .extend({ offset: z.number().int().min(0), data: z.string().max(Math.ceil(chunkLimit / 3) * 4) })
      .strict()
      .parse(raw);
    const scope = { workspaceId: input.workspaceId };
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data))
      suiteFail('SUITE_BASE64');
    const bytes = Buffer.from(input.data, 'base64');
    if (!bytes.length || bytes.length > chunkLimit || bytes.toString('base64') !== input.data)
      suiteFail('SUITE_CHUNK_LIMIT');
    return this.changeUploads(scope, async (rows) => {
      const row = this.requireUpload(rows, scope, input.id);
      if (row.state !== 'uploading' || row.offset !== input.offset || row.offset + bytes.length > row.bytes)
        suiteFail('SUITE_UPLOAD_OFFSET');
      const file = this.file(row.id);
      await this.io(file, bytes.length, 'write', async () => {
        await this.access(scope);
        const original = await this.regular(file);
        if (
          !row.identity ||
          String(original.ino) !== row.identity.ino ||
          String(original.dev) !== row.identity.dev
        )
          suiteFail('SUITE_MATERIAL_IDENTITY');
        if (original.size !== row.offset)
          suiteFail('SUITE_UPLOAD_UNKNOWN', '文件长度与持久回执不一致，需核对原上传');
        const handle = await open(file, 'r+');
        try {
          const bound = await handle.stat();
          if (
            bound.ino !== original.ino ||
            bound.dev !== original.dev ||
            bound.size !== row.offset ||
            bound.nlink !== 1
          )
            suiteFail('SUITE_MATERIAL_IDENTITY');
          await this.access(scope);
          const result = await handle.write(bytes, 0, bytes.length, row.offset);
          if (result.bytesWritten !== bytes.length) suiteFail('SUITE_SHORT_WRITE');
          await handle.sync();
        } finally {
          await handle.close();
        }
        const final = await this.regular(file);
        if (
          final.ino !== original.ino ||
          final.dev !== original.dev ||
          final.size !== row.offset + bytes.length
        )
          suiteFail('SUITE_MATERIAL_IDENTITY');
        row.identity = {
          ino: String(final.ino),
          dev: String(final.dev),
          bytes: final.size,
          mtimeMs: final.mtimeMs,
          ctimeMs: final.ctimeMs,
        };
      });
      row.offset += bytes.length;
      return row;
    });
  }
  private async discardOwned(scope: S.SuiteScope, id: string, ready: boolean): Promise<S.SuiteUpload> {
    const intent = await this.changeUploads(scope, (rows) => {
      const row = this.requireUpload(rows, scope, id);
      if (row.state === 'discarded') return row;
      if (row.state === 'ready' && !ready) suiteFail('SUITE_SOURCE_ARCHIVE_REQUIRED');
      if (this.readers.get(id)) suiteFail('SUITE_MATERIAL_READ_ACTIVE');
      if (!row.identity) suiteFail('SUITE_MATERIAL_IDENTITY', '原文件创建身份未确认，保留材料等待核对');
      row.state = 'unknown';
      return row;
    });
    if (intent.state === 'discarded') return intent;
    const file = this.file(id);
    await this.io(file, 0, 'write', async () => {
      await this.access(scope);
      try {
        const info = await this.regular(file);
        if (
          String(info.ino) !== intent.identity!.ino ||
          String(info.dev) !== intent.identity!.dev ||
          info.size > intent.bytes
        )
          suiteFail('SUITE_MATERIAL_IDENTITY');
        if (this.readers.get(id)) suiteFail('SUITE_MATERIAL_READ_ACTIVE');
        await unlink(file);
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    });
    await this.settleFor({ ...scope, id: intent.reservationId, release: true }, this.issuer);
    return this.changeUploads(scope, (rows) => {
      const row = this.requireUpload(rows, scope, id);
      row.state = 'discarded';
      return row;
    });
  }
  async discardUpload(raw: S.SuiteScope & { id: string }): Promise<S.SuiteUpload> {
    const input = uploadKey.parse(raw),
      scope = { workspaceId: input.workspaceId };
    const upload = this.requireUpload((await this.ledger()).uploads, scope, input.id);
    if (
      upload.source ||
      (await this.readState()).rows.some(
        (r) =>
          r.kind === 'source' &&
          r.content &&
          typeof r.content === 'object' &&
          !Array.isArray(r.content) &&
          r.content.blobId === input.id,
      )
    )
      suiteFail('SUITE_SOURCE_ARCHIVE_REQUIRED');
    return this.discardOwned(scope, input.id, false);
  }
  protected override async releaseOwned(scope: S.SuiteScope, record: S.SuiteRecord): Promise<void> {
    if (record.kind !== 'source') return;
    await this.assertNotReading(scope, { domain: this.domain, id: record.id, revision: record.revision });
    const material = S.suiteMaterial.parse(record.content);
    await this.discardOwned(scope, material.blobId, true);
  }
  /** 仅供本插件的交换协调者核销私有材料，不进入公共服务契约。 */
  async dropPrivateSource(raw: S.SuitePin): Promise<void> {
    const pin = S.suitePin.parse(raw),
      scope = { workspaceId: pin.workspaceId };
    await this.access(scope);
    const state = await this.readState(),
      row = state.rows.find(
        (r) =>
          r.workspaceId === pin.workspaceId &&
          r.actor === suiteActor() &&
          r.id === pin.id &&
          r.revision === pin.revision,
      );
    if (!row) {
      const receipt = state.rows.some(
        (r) =>
          r.workspaceId === pin.workspaceId &&
          r.kind === 'result' &&
          r.content &&
          typeof r.content === 'object' &&
          !Array.isArray(r.content) &&
          r.content.droppedPrivateSource === pin.id &&
          r.content.revision === pin.revision,
      );
      if (!receipt) suiteFail('SUITE_CLEANUP_UNKNOWN');
      return;
    }
    if (row.kind !== 'source' || state.holds.some((h) => h.id === row.id && h.revision === row.revision))
      suiteFail('SUITE_CONTENT_PROTECTED');
    await this.releaseOwned(scope, row);
    await this.put(
      {
        ...scope,
        name: '私有交接材料清理回执',
        content: { droppedPrivateSource: pin.id, revision: pin.revision, cleanup: 'confirmed' },
        references: [],
      },
      'result',
      true,
    );
    await this.edit(
      (current) => {
        if (current.holds.some((h) => h.id === row.id && h.revision === row.revision))
          suiteFail('SUITE_CONTENT_PROTECTED');
        current.rows = current.rows.filter(
          (r) => !(r.id === pin.id && r.revision === pin.revision && r.workspaceId === pin.workspaceId),
        );
        return { workspaceId: pin.workspaceId };
      },
      true,
      scope,
    );
  }
  async finishUpload(raw: S.SuiteScope & { id: string }): Promise<S.SuiteRecord> {
    const input = uploadKey.parse(raw),
      scope = { workspaceId: input.workspaceId };
    return this.changeUploads(scope, async (rows) => {
      const row = this.requireUpload(rows, scope, input.id);
      if (row.state === 'ready' && row.source)
        return this.get({ ...scope, id: row.source.id, revision: row.source.revision });
      if (row.state !== 'uploading' || row.offset !== row.bytes) suiteFail('SUITE_UPLOAD_INCOMPLETE');
      const file = this.file(row.id);
      const checked = await this.io(file, chunkLimit, 'read', async () => {
        const original = await this.regular(file);
        if (original.size !== row.bytes) suiteFail('SUITE_MATERIAL_IDENTITY');
        const handle = await open(file, 'r');
        const hash = createHash('sha256');
        try {
          const bound = await handle.stat();
          if (bound.ino !== original.ino || bound.dev !== original.dev || bound.nlink !== 1)
            suiteFail('SUITE_MATERIAL_IDENTITY');
          const buffer = Buffer.allocUnsafe(chunkLimit);
          for (let offset = 0; offset < row.bytes;) {
            await this.access(scope);
            const { bytesRead } = await handle.read(
              buffer,
              0,
              Math.min(chunkLimit, row.bytes - offset),
              offset,
            );
            if (!bytesRead) suiteFail('SUITE_SHORT_READ');
            hash.update(buffer.subarray(0, bytesRead));
            offset += bytesRead;
          }
          const final = await handle.stat();
          if (final.size !== row.bytes || final.mtimeMs !== original.mtimeMs)
            suiteFail('SUITE_MATERIAL_CHANGED');
        } finally {
          await handle.close();
        }
        const final = await this.regular(file);
        if (
          final.ino !== original.ino ||
          final.dev !== original.dev ||
          final.size !== original.size ||
          final.mtimeMs !== original.mtimeMs
        )
          suiteFail('SUITE_MATERIAL_CHANGED');
        return {
          digest: hash.digest('hex'),
          identity: {
            ino: String(final.ino),
            dev: String(final.dev),
            bytes: final.size,
            mtimeMs: final.mtimeMs,
            ctimeMs: final.ctimeMs,
          },
        };
      });
      if (checked.digest !== row.digest) suiteFail('SUITE_MATERIAL_DIGEST');
      const published = (await this.readState()).rows.find(
        (r) =>
          r.workspaceId === row.workspaceId &&
          r.actor === row.actor &&
          r.kind === 'source' &&
          typeof r.content === 'object' &&
          r.content !== null &&
          !Array.isArray(r.content) &&
          r.content.blobId === row.id,
      );
      if (published && JSON.stringify(published.references) !== JSON.stringify(row.lineage))
        suiteFail('SUITE_MATERIAL_LINEAGE', '原上传的来源保护与已发布材料不一致');
      const result = published
        ? await super.get({ ...scope, id: published.id, revision: published.revision })
        : await this.put(
            {
              ...scope,
              name: row.name,
              id: row.sourceId,
              expectedRevision: row.expectedRevision,
              content: {
                blobId: row.id,
                bytes: row.bytes,
                digest: row.digest,
                format: row.format,
                allowRead: true,
                allowExport: row.allowExport,
              },
              references: row.lineage,
            },
            'source',
            true,
          );
      await this.edit((state) => {
        if (!state.policies.some((p) => p.id === result.id))
          state.policies.push({
            id: result.id,
            workspaceId: result.workspaceId,
            revision: result.policyRevision,
            allowRead: true,
            allowExport: row.allowExport,
          });
        return result;
      });
      row.state = 'ready';
      row.identity = checked.identity;
      row.source = { domain: result.domain, id: result.id, revision: result.revision };
      await this.settleFor({ ...scope, id: row.reservationId }, this.issuer);
      return result;
    });
  }
  async readSource(raw: S.SuitePin & { offset: number; length: number; purpose?: 'read' | 'export' }) {
    const input = S.suitePin
      .extend({
        offset: z.number().int().min(0),
        length: z.number().int().positive().max(chunkLimit),
        purpose: z.enum(['read', 'export']).default('read'),
      })
      .strict()
      .parse(raw);
    const scope = { workspaceId: input.workspaceId },
      source = await this.get({ ...scope, id: input.id, revision: input.revision });
    const material = S.suiteMaterial.parse(source.content);
    if (source.state !== 'sealed') suiteFail('SUITE_SOURCE_ARCHIVED');
    const policy = (await this.readState()).policies.find(
      (p) => p.id === source.id && p.workspaceId === input.workspaceId,
    );
    if (!policy?.allowRead || (input.purpose === 'export' && !policy.allowExport))
      suiteFail('SUITE_SOURCE_PERMISSION', '材料当前许可拒绝此用途', 403);
    const upload = this.requireUpload((await this.ledger()).uploads, scope, material.blobId);
    if (upload.state !== 'ready' || upload.digest !== material.digest || input.offset > material.bytes)
      suiteFail('SUITE_MATERIAL_UNAVAILABLE');
    const file = this.file(material.blobId),
      revision = policy.revision,
      workspacePolicyRevision = await this.currentWorkspaceRevision(scope);
    this.readers.set(material.blobId, (this.readers.get(material.blobId) ?? 0) + 1);
    try {
      return await this.io(file, input.length, 'read', async () => {
        const original = await this.regular(file),
          identity = upload.identity;
        if (
          !identity ||
          original.size !== material.bytes ||
          String(original.ino) !== identity.ino ||
          String(original.dev) !== identity.dev ||
          original.mtimeMs !== identity.mtimeMs ||
          original.ctimeMs !== identity.ctimeMs
        )
          suiteFail('SUITE_MATERIAL_IDENTITY');
        const handle = await open(file, 'r');
        try {
          const bound = await handle.stat();
          if (bound.ino !== original.ino || bound.dev !== original.dev || bound.nlink !== 1)
            suiteFail('SUITE_MATERIAL_IDENTITY');
          const bytes = Buffer.alloc(Math.min(input.length, material.bytes - input.offset));
          const { bytesRead } = await handle.read(bytes, 0, bytes.length, input.offset);
          const final = await this.regular(file);
          if (
            bytesRead !== bytes.length ||
            final.ino !== original.ino ||
            final.dev !== original.dev ||
            final.mtimeMs !== original.mtimeMs
          )
            suiteFail('SUITE_MATERIAL_CHANGED');
          const current = (await this.readState()).policies.find(
            (p) => p.id === source.id && p.workspaceId === input.workspaceId,
          );
          await this.access(scope);
          if (
            !current?.allowRead ||
            current.revision !== revision ||
            (input.purpose === 'export' && !current.allowExport) ||
            (await this.currentWorkspaceRevision(scope)) !== workspacePolicyRevision
          )
            suiteFail('SUITE_SOURCE_PERMISSION', '材料许可已变化', 403);
          return {
            data: bytes.toString('base64'),
            offset: input.offset + bytesRead,
            eof: input.offset + bytesRead === material.bytes,
          };
        } finally {
          await handle.close();
        }
      });
    } finally {
      const count = (this.readers.get(material.blobId) ?? 1) - 1;
      if (count) this.readers.set(material.blobId, count);
      else this.readers.delete(material.blobId);
    }
  }
  async planPolicy(
    raw: S.SuitePin & { expectedPolicyRevision: number; allowRead: boolean; allowExport: boolean },
  ) {
    const input = S.suitePin
      .extend({
        expectedPolicyRevision: z.number().int().positive(),
        allowRead: z.boolean(),
        allowExport: z.boolean(),
      })
      .strict()
      .parse(raw);
    const source = await super.get({
      workspaceId: input.workspaceId,
      id: input.id,
      revision: input.revision,
    });
    if (source.kind !== 'source' || source.policyRevision !== input.expectedPolicyRevision)
      suiteFail('SUITE_POLICY_CHANGED');
    return this.plan({ workspaceId: input.workspaceId }, 'source-policy', input, []);
  }
  async applyPolicy(raw: S.SuiteApproval) {
    const plan = await this.consume(raw, 'source-policy');
    const input = S.suitePin
      .extend({
        expectedPolicyRevision: z.number().int().positive(),
        allowRead: z.boolean(),
        allowExport: z.boolean(),
      })
      .strict()
      .parse(plan.input);
    if (plan.state === 'completed' && plan.result)
      return super.get({
        workspaceId: input.workspaceId,
        id: plan.result.id,
        revision: plan.result.revision,
      });
    const result = await this.edit((state) => {
      const policy = state.policies.find((p) => p.id === input.id && p.workspaceId === input.workspaceId);
      if (!policy || policy.revision !== input.expectedPolicyRevision) suiteFail('SUITE_POLICY_CHANGED');
      policy.allowRead = input.allowRead;
      policy.allowExport = input.allowExport;
      policy.revision++;
      for (const row of state.rows.filter((r) => r.id === input.id && r.workspaceId === input.workspaceId))
        row.policyRevision = policy.revision;
      return state.rows.find(
        (r) => r.id === input.id && r.revision === input.revision && r.workspaceId === input.workspaceId,
      )!;
    }, true);
    await this.complete(plan, result);
    return result;
  }
  override async close(): Promise<void> {
    await this.uploadTail;
    await super.close();
  }
  protected override async assertQuarantineEmpty(scope: S.SuiteScope): Promise<void> {
    await super.assertQuarantineEmpty(scope);
    const ledger = await this.ledger();
    if (
      ledger.uploads.some(
        (upload) => upload.workspaceId === scope.workspaceId && upload.state !== 'discarded',
      ) ||
      ledger.leases.some(
        (lease) =>
          lease.workspaceId === scope.workspaceId &&
          lease.state === 'active' &&
          Date.parse(lease.expiresAt) > Date.now(),
      )
    )
      suiteFail('SUITE_QUARANTINE_MATERIAL_UNKNOWN', '隔离上传或读取租约尚未确认结束');
  }
}
