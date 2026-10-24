/** 独立字节仓库、许可与全域容量账本。 Owns source bytes, live permissions and cross-domain capacity. */
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, writeFile, rename, unlink, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import { metadataPath } from './plugin-metadata.ts';
import { storageRuntime } from './storage-runtime.ts';
import type { FilesV2 } from './service-contracts/files-v2.ts';
import type { KnowledgeSourcesV1 } from './service-contracts/knowledge-studio.ts';
import * as K from '../shared/contracts/knowledge-studio.ts';
import { captureRequestSchema, captureRefreshSchema } from '../shared/contracts/files-capture.ts';
import {
  actor,
  base,
  consumer,
  fail,
  hash,
  KnowledgePlans,
  now,
  sha,
  sensitive,
  type KnowledgeAuthorize,
} from './knowledge-store.ts';
const stateSchema = z
  .object({
    spaces: z.array(K.spaceSchema).max(20),
    sources: z.array(K.sourceSchema).max(50000),
    blobs: z.array(K.blobSchema).max(50000),
    capacity: z.array(K.capacitySchema).max(50000),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
const M = 1024 ** 2,
  RESERVE = M,
  TOTAL = 12 * 1024 ** 3;
const decode = (data: string, max = 16 * M) => {
  if (
    data.length > Math.ceil(max / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
  )
    fail('SOURCE_FORMAT_UNSUPPORTED', '无效或超限的 base64 字节', 413);
  const b = Buffer.from(data, 'base64');
  if (b.length > max) fail('EXTRACT_LIMIT', '字节超过预算', 413);
  return b;
};
export class KnowledgeSources implements KnowledgeSourcesV1 {
  private accepting = new AsyncLocalStorage<string>();
  private root: string;
  private tail: Promise<unknown> = Promise.resolve();
  private plans: KnowledgePlans;
  constructor(
    private metadata: PluginMetadata,
    plans: PluginMetadata,
    private authorize: KnowledgeAuthorize,
    private files?: FilesV2,
  ) {
    this.root = join(dirname(metadataPath(metadata)), 'knowledge-bytes');
    this.plans = new KnowledgePlans(plans, authorize, this);
  }
  private io<T>(mode: 'read' | 'write', path: string, bytes: number, work: () => Promise<T>) {
    return storageRuntime.run(
      {
        owner: 'knowledge-sources',
        taskId: randomUUID(),
        label: 'knowledge-fixed-bytes',
        paths: [path],
        mode,
        buffers: Math.min(bytes, 16 * M),
        files: 1,
        ...(mode === 'write' ? { temporary: [{ path, bytes }] } : {}),
      },
      async () => {
        await this.authorize();
        const result = await work();
        await this.authorize();
        return result;
      },
    );
  }
  private async state() {
    await this.authorize();
    const s = stateSchema.parse(
      (await this.metadata.read()).value ?? { spaces: [], sources: [], blobs: [], capacity: [] },
    );
    await this.authorize();
    return s;
  }
  private require(s: State, spaceId: string, allowRevoked = false) {
    K.kid.parse(spaceId);
    const row = s.spaces.find((v) => v.id === spaceId);
    if (!row) fail('KNOWLEDGE_NOT_FOUND', '知识空间不存在', 404);
    if (row.quarantined && this.accepting.getStore() !== spaceId)
      fail('BUNDLE_UNVERIFIED', '空间尚在隔离接收中', 403);
    if (row.revoked && !allowRevoked) fail('SOURCE_USE_REVOKED', '知识空间已撤销', 403);
    return row;
  }
  private change<T>(edit: (s: State) => Promise<T> | T, recovery = false): Promise<T> {
    const work = this.tail.then(async () => {
      await this.authorize();
      const snap = await this.metadata.read();
      const s = stateSchema.parse(snap.value ?? { spaces: [], sources: [], blobs: [], capacity: [] });
      const out = await edit(s);
      stateSchema.parse(s);
      const ownBytes = Buffer.byteLength(JSON.stringify(s));
      if (ownBytes > (recovery ? 33 : 32) * M) fail('KNOWLEDGE_QUOTA', '来源元数据达到上限', 413);
      if (!recovery) {
        const accounted = (temporary: boolean) =>
          s.capacity
            .filter((c) => temporary || c.kind !== 'temporary')
            .reduce((n, c) => n + (c.state === 'committed' ? c.actual : c.bytes), ownBytes);
        if (accounted(true) + RESERVE > TOTAL || accounted(false) > 10 * 1024 ** 3)
          fail('KNOWLEDGE_QUOTA', '知识容量不足，元数据及恢复预留计入总量', 413);
      }
      await this.metadata.replace(s, {
        expectedRevision: snap.revision,
        beforeCommit: () => this.authorize(),
      });
      return structuredClone(out);
    });
    this.tail = work.catch(() => {});
    return work;
  }
  async createSpace(input: { name: string }) {
    const p = z
      .object({ name: z.string().min(1).max(120) })
      .strict()
      .parse(input);
    return this.change((s) => {
      if (s.spaces.length >= 20) fail('KNOWLEDGE_QUOTA', '最多 20 个知识空间', 413);
      const space: K.Space = {
        id: randomUUID(),
        name: p.name,
        createdAt: now(),
        actor: actor(),
        revoked: false,
        quarantined: false,
        revision: 1,
      };
      s.spaces.push(space);
      return space;
    });
  }
  async importSpace(input: { name: string }, construct: (space: K.Space) => Promise<void>) {
    const p = z
      .object({ name: z.string().min(1).max(120) })
      .strict()
      .parse(input);
    const space = await this.change((s) => {
      if (s.spaces.length >= 20) fail('KNOWLEDGE_QUOTA', '最多 20 个知识空间', 413);
      const row: K.Space = {
        id: randomUUID(),
        name: p.name,
        createdAt: now(),
        actor: actor(),
        revoked: false,
        quarantined: true,
        revision: 1,
      };
      s.spaces.push(row);
      return row;
    });
    return this.accepting.run(space.id, async () => {
      await construct(space);
      await this.authorize();
      return this.change((s) => {
        const row = this.require(s, space.id);
        row.quarantined = false;
        row.revision++;
        return row;
      });
    });
  }
  async listSpaces() {
    return (await this.state()).spaces.filter((s) => !s.quarantined);
  }
  async space(input: { spaceId: string }) {
    K.scopeSchema.parse(input);
    return this.require(await this.state(), input.spaceId);
  }
  async revokeSpace(input: { spaceId: string; expectedRevision: number; revoked: boolean }) {
    const p = K.scopeSchema
      .extend({ expectedRevision: z.number().int().positive(), revoked: z.boolean() })
      .strict()
      .parse(input);
    return this.change((s) => {
      const row = this.require(s, p.spaceId, true);
      if (row.revision !== p.expectedRevision) fail('REVISION_CONFLICT', '空间修订已改变');
      row.revoked = p.revoked;
      row.revision++;
      return row;
    }, true);
  }
  async listSources(input: { spaceId: string }) {
    K.scopeSchema.parse(input);
    const s = await this.state();
    this.require(s, input.spaceId);
    return s.sources.filter((v) => v.spaceId === input.spaceId);
  }
  private source(s: State, p: K.Pin) {
    this.require(s, p.spaceId);
    const row = s.sources.find((v) => v.spaceId === p.spaceId && v.id === p.id && v.revision === p.revision);
    if (!row) fail('KNOWLEDGE_NOT_FOUND', '来源固定修订不存在', 404);
    if (row.revoked || !row.policy[p.purpose]) fail('SOURCE_USE_REVOKED', '来源未许可此用途', 403);
    return row;
  }
  async getSource(input: K.Pin) {
    const p = K.pinSchema.parse(input);
    return this.source(await this.state(), p);
  }
  async check(input: {
    spaceId: string;
    dependencies: K.Dependency[];
    purpose: K.Purpose;
    exactPolicy?: boolean;
  }) {
    const p = K.scopeSchema
      .extend({
        dependencies: z.array(K.dependencySchema).max(2000),
        purpose: K.purposeSchema,
        exactPolicy: z.boolean().optional(),
      })
      .strict()
      .parse(input);
    const s = await this.state();
    this.require(s, p.spaceId);
    return p.dependencies.map((d) => {
      const r = this.source(s, { spaceId: p.spaceId, id: d.id, revision: d.revision, purpose: p.purpose });
      if (r.digest !== d.digest) fail('CITATION_MISMATCH', '来源摘要不符');
      if (p.exactPolicy && r.policyRevision !== d.policyRevision) fail('REVIEW_STALE', '来源许可修订改变');
      return { id: r.id, revision: r.revision, digest: r.digest, policyRevision: r.policyRevision };
    });
  }
  /** 在持久串行账本中预留上界；不确定写入不能自动退款。 Reserve upper bounds before I/O. */
  async reserveCapacity(input: Parameters<KnowledgeSourcesV1['reserveCapacity']>[0]) {
    const p = K.scopeSchema
      .extend({
        bytes: z
          .number()
          .int()
          .min(0)
          .max(1024 ** 3),
        objects: z.number().int().min(0).max(10000),
        kind: z.enum(['metadata', 'blob', 'temporary']),
        operationId: z.string().min(1).max(200),
        slot: z.string().max(120).optional(),
      })
      .strict()
      .parse(input);
    const owner = consumer();
    return this.change(async (s) => {
      this.require(s, p.spaceId);
      const prior = s.capacity.find((c) => c.owner === owner && c.operationId === p.operationId);
      if (prior) {
        if (prior.bytes !== p.bytes || prior.kind !== p.kind)
          fail('REVISION_CONFLICT', '同一操作的容量输入改变');
        return prior;
      }
      await mkdir(this.root, { recursive: true });
      let physical = 0;
      for (const file of await readdir(this.root)) {
        const info = await stat(join(this.root, file));
        if (info.isFile()) physical += info.size;
      }
      const ownMetadataBytes = Buffer.byteLength(JSON.stringify(s));
      const billed = s.capacity.reduce(
        (n, c) => n + (c.state === 'committed' ? c.actual : c.bytes),
        ownMetadataBytes,
      );
      const permanentBilled = s.capacity
        .filter((c) => c.kind !== 'temporary')
        .reduce((n, c) => n + (c.state === 'committed' ? c.actual : c.bytes), ownMetadataBytes);
      const metadataBytes = s.capacity
        .filter((c) => c.kind === 'metadata')
        .reduce((n, c) => n + (c.state === 'committed' ? c.actual : c.bytes), ownMetadataBytes);
      const objects = s.sources.length + s.spaces.length + s.capacity.reduce((n, c) => n + c.objects, 0);
      if (
        objects + p.objects > 50000 ||
        s.sources.filter((r) => r.spaceId === p.spaceId).length +
          s.capacity.filter((c) => c.spaceId === p.spaceId).reduce((n, c) => n + c.objects, 0) +
          p.objects >
          10000
      )
        fail('KNOWLEDGE_QUOTA', '知识对象修订数量达到上限', 413);
      if (
        Math.max(billed, metadataBytes + physical) + p.bytes + RESERVE > TOTAL ||
        permanentBilled + (p.kind === 'temporary' ? 0 : p.bytes) > 10 * 1024 ** 3
      )
        fail('KNOWLEDGE_QUOTA', '知识总容量不足，预留恢复空间不可占用', 413);
      if (
        p.kind === 'metadata' &&
        (metadataBytes + p.bytes > 256 * M ||
          s.capacity
            .filter((c) => c.spaceId === p.spaceId && c.kind === 'metadata')
            .reduce((n, c) => n + c.bytes, 0) +
            p.bytes >
            32 * M)
      )
        fail('KNOWLEDGE_QUOTA', '元数据容量达到上限', 413);
      const c: K.Capacity = {
        token: randomUUID(),
        spaceId: p.spaceId,
        bytes: p.bytes,
        owner,
        operationId: p.operationId,
        slot: p.slot,
        state: 'reserved',
        actual: 0,
        objects: p.objects,
        kind: p.kind,
      };
      s.capacity.push(c);
      return c;
    });
  }
  async commitCapacity(input: { spaceId: string; token: string; actual: number }) {
    const p = K.scopeSchema
      .extend({ token: K.kid, actual: z.number().int().min(0) })
      .strict()
      .parse(input);
    const owner = consumer();
    return this.change((s) => {
      const c = s.capacity.find((c) => c.token === p.token && c.spaceId === p.spaceId && c.owner === owner);
      if (!c || p.actual > c.bytes) fail('KNOWLEDGE_QUOTA', '容量回执无效');
      if (c.kind === 'metadata' && c.slot)
        s.capacity = s.capacity.filter(
          (v) =>
            v === c ||
            v.state !== 'committed' ||
            v.owner !== owner ||
            v.slot !== c.slot ||
            v.spaceId !== c.spaceId,
        );
      c.state = 'committed';
      c.actual = p.actual;
      return c;
    }, true);
  }
  async releaseCapacity(input: { spaceId: string; token: string }) {
    const p = K.scopeSchema.extend({ token: K.kid }).strict().parse(input);
    await this.change((s) => {
      const c = s.capacity.find(
        (c) => c.token === p.token && c.spaceId === p.spaceId && c.owner === consumer(),
      );
      if (!c) fail('KNOWLEDGE_NOT_FOUND', '容量回执不存在');
      if (s.blobs.some((b) => b.reservation === c.token)) fail('KNOWLEDGE_RETAINED', '字节仍持有容量');
      if (c.kind === 'metadata') fail('KNOWLEDGE_CLEANUP_PENDING', '未确认的元数据写入保留容量');
      s.capacity = s.capacity.filter((v) => v !== c);
    }, true);
  }
  async capacity(input: { spaceId: string }) {
    await this.space(input);
    const s = await this.state();
    return {
      used: s.capacity
        .filter((c) => c.state === 'committed')
        .reduce((n, c) => n + c.actual, RESERVE + Buffer.byteLength(JSON.stringify(s))),
      reserved: s.capacity.filter((c) => c.state !== 'committed').reduce((n, c) => n + c.bytes, 0),
      totalLimit: TOTAL,
      recoveryReserve: RESERVE,
    };
  }
  async reserveQuarantine(input: { bytes: number; operationId: string }) {
    const p = z
      .object({
        bytes: z
          .number()
          .int()
          .min(0)
          .max(64 * M),
        operationId: K.kid,
      })
      .strict()
      .parse(input);
    return this.change((s) => {
      const used = s.capacity.reduce((n, c) => n + (c.state === 'committed' ? c.actual : c.bytes), RESERVE);
      if (
        used + p.bytes > TOTAL ||
        s.capacity
          .filter((c) => c.spaceId === null)
          .reduce((n, c) => n + (c.state === 'committed' ? c.actual : c.bytes), 0) +
          p.bytes >
          2 * 1024 ** 3
      )
        fail('KNOWLEDGE_QUOTA', '隔离区总容量不足', 413);
      const c: K.Capacity = {
        token: randomUUID(),
        spaceId: null,
        owner: consumer(),
        operationId: p.operationId,
        bytes: p.bytes,
        objects: 1,
        state: 'reserved',
        actual: 0,
        kind: 'temporary',
      };
      s.capacity.push(c);
      return c;
    });
  }
  async settleQuarantine(input: { token: string; actual: number }) {
    const p = z
      .object({ token: K.kid, actual: z.number().int().min(0) })
      .strict()
      .parse(input);
    return this.change((s) => {
      const c = s.capacity.find((c) => c.token === p.token && c.spaceId === null && c.owner === consumer());
      if (!c || p.actual > c.bytes) fail('KNOWLEDGE_QUOTA', '隔离区容量回执无效');
      c.actual = p.actual;
      c.state = 'committed';
      return c;
    }, true);
  }
  private async put(
    spaceId: string,
    bytes: Buffer,
    kind: K.BlobReceipt['kind'],
    dependencies: K.Dependency[],
  ) {
    const reservation = await this.reserveCapacity({
      spaceId,
      bytes: bytes.length * 2 + 4096,
      objects: 1,
      kind: 'blob',
      operationId: randomUUID(),
    });
    const id = randomUUID(),
      temp = join(this.root, id + '.pending'),
      target = join(this.root, id);
    await mkdir(this.root, { recursive: true });
    await this.io('write', temp, bytes.length, async () => {
      await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
      if (sha(await readFile(temp)) !== sha(bytes)) fail('CITATION_MISMATCH', '暂存字节校验失败');
      await this.authorize();
      await rename(temp, target);
    });
    const receipt: K.BlobReceipt = {
      id,
      spaceId,
      digest: sha(bytes),
      bytes: bytes.length,
      kind,
      dependencies,
      owner: consumer(),
      holds: [],
      state: 'ready',
      reservation: reservation.token,
    };
    await this.change((s) => {
      this.require(s, spaceId);
      s.blobs.push(receipt);
    });
    await this.commitCapacity({ spaceId, token: reservation.token, actual: bytes.length });
    return receipt;
  }
  async upload(input: Parameters<KnowledgeSourcesV1['upload']>[0]) {
    const p = K.scopeSchema
      .extend({
        name: z
          .string()
          .min(1)
          .max(240)
          .refine((s) => !/[\\/\x00-\x1f]/.test(s)),
        format: K.formatSchema,
        data: z.string().max(24 * M),
        policy: K.policySchema,
        sourceId: K.kid.optional(),
        expectedRevision: z.number().int().positive().optional(),
      })
      .strict()
      .parse(input);
    await this.space({ spaceId: p.spaceId });
    const bytes = decode(p.data);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      fail('SOURCE_FORMAT_UNSUPPORTED', '只支持 UTF-8 文本', 415);
    }
    if (text!.includes('\0')) fail('SOURCE_FORMAT_UNSUPPORTED', '二进制材料不支持', 415);
    if (bytes.length > 8 * M) fail('EXTRACT_LIMIT', '文本超过 8 MiB', 413);
    const blob = await this.put(p.spaceId, bytes, 'source', []);
    const source = await this.change((s) => {
      this.require(s, p.spaceId);
      const rows = s.sources.filter((r) => r.spaceId === p.spaceId);
      if (rows.reduce((n, r) => n + r.bytes, 0) + bytes.length > 2 * 1024 ** 3)
        fail('KNOWLEDGE_QUOTA', '空间材料达到 2 GiB', 413);
      const revisions = p.sourceId ? rows.filter((r) => r.id === p.sourceId) : [];
      const current = Math.max(0, ...revisions.map((r) => r.revision));
      if (p.sourceId && current !== p.expectedRevision) fail('REVISION_CONFLICT', '来源已有新版本');
      if (revisions.length && hash(revisions.at(-1)!.policy) !== hash(p.policy))
        fail('REVISION_CONFLICT', '更新来源不能更改许可，请先使用许可计划');
      if (!p.sourceId && new Set(rows.map((r) => r.id)).size >= 2000)
        fail('KNOWLEDGE_QUOTA', '空间最多 2000 个来源', 413);
      const r: K.Source = {
        ...base(p.spaceId, {}, [], p.sourceId, current + 1),
        digest: blob.digest,
        name: p.name,
        format: p.format,
        bytes: bytes.length,
        blobId: blob.id,
        origin: 'upload',
        policy: p.policy,
        policyRevision: revisions.at(-1)?.policyRevision ?? 1,
        revoked: revisions.at(-1)?.revoked ?? false,
        sensitive: sensitive(text!),
        redactions: [],
      };
      s.sources.push(r);
      s.blobs.find((b) => b.id === blob.id)!.holds.push(`source:${r.id}:${r.revision}`);
      return r;
    });
    return source;
  }
  async read(input: K.Pin) {
    const p = K.pinSchema.parse(input),
      source = await this.getSource(p);
    const data = await this.io('read', join(this.root, source.blobId), source.bytes, () =>
      readFile(join(this.root, source.blobId)),
    );
    if (data.length !== source.bytes || sha(data) !== source.digest)
      fail('CITATION_MISMATCH', '固定来源字节损坏');
    const current = await this.getSource(p);
    if (current.policyRevision !== source.policyRevision) fail('SOURCE_USE_REVOKED', '读取期间许可改变', 403);
    return { source: current, data: data.toString('base64') };
  }
  async verify(input: K.Pin) {
    const { source } = await this.read(input);
    return { digest: source.digest, bytes: source.bytes };
  }
  async redact(input: Parameters<KnowledgeSourcesV1['redact']>[0]) {
    const p = K.pinSchema
      .extend({
        ranges: z
          .array(z.object({ start: z.number().int().min(0), end: z.number().int().positive() }).strict())
          .min(1)
          .max(1000),
        name: z.string().min(1).max(240),
        policy: K.policySchema,
      })
      .strict()
      .parse(input);
    const raw = await this.read(
      K.pinSchema.parse({ spaceId: p.spaceId, id: p.id, revision: p.revision, purpose: 'read' }),
    );
    const bytes = Buffer.from(raw.data, 'base64'),
      ranges = [...p.ranges].sort((a, b) => a.start - b.start);
    let last = 0;
    const parts: Buffer[] = [];
    for (const r of ranges) {
      if (r.start < last || r.end <= r.start || r.end > bytes.length) fail('EXTRACT_LIMIT', '遮盖区间无效');
      parts.push(bytes.subarray(last, r.start), Buffer.from('[已遮盖]'));
      last = r.end;
    }
    parts.push(bytes.subarray(last));
    const result = await this.upload({
      spaceId: p.spaceId,
      name: p.name,
      format: raw.source.format,
      data: Buffer.concat(parts).toString('base64'),
      policy: p.policy,
    });
    return this.change((s) => {
      const r = s.sources.find((v) => v.id === result.id)!;
      r.origin = 'redacted';
      r.originDigest = raw.source.digest;
      r.redactions = ranges;
      return r;
    });
  }
  async planPolicy(input: Parameters<KnowledgeSourcesV1['planPolicy']>[0]) {
    const p = K.scopeSchema
      .extend({
        id: K.kid,
        expectedRevision: z.number().int().positive(),
        policy: K.policySchema,
        revoked: z.boolean(),
      })
      .strict()
      .parse(input);
    const rows = await this.listSources({ spaceId: p.spaceId });
    if (!rows.some((r) => r.id === p.id && r.policyRevision === p.expectedRevision))
      fail('REVISION_CONFLICT', '许可已改变');
    const s = await this.state();
    const holders = s.blobs
      .filter(
        (b) =>
          b.spaceId === p.spaceId &&
          (rows.some((r) => r.id === p.id && r.blobId === b.id) || b.dependencies.some((d) => d.id === p.id)),
      )
      .flatMap((b) => b.holds);
    return this.plans.create(p.spaceId, p, ['许可将作用于该来源的全部修订', ...holders], true);
  }
  async applyPolicy(input: { spaceId: string; token: string }) {
    const p = await this.plans.consume(
      input.spaceId,
      input.token,
      K.scopeSchema
        .extend({
          id: K.kid,
          expectedRevision: z.number().int().positive(),
          policy: K.policySchema,
          revoked: z.boolean(),
        })
        .strict(),
    );
    return this.change((s) => {
      const rows = s.sources.filter((r) => r.spaceId === p.spaceId && r.id === p.id);
      if (!rows.length || rows.some((r) => r.policyRevision !== p.expectedRevision))
        fail('REVISION_CONFLICT', '许可已改变');
      for (const r of rows) {
        r.policy = p.policy;
        r.revoked = p.revoked;
        r.policyRevision++;
      }
      return rows.at(-1)!;
    }, true);
  }
  async writeDerived(input: Parameters<KnowledgeSourcesV1['writeDerived']>[0]) {
    const p = K.scopeSchema
      .extend({
        data: z.string().max(90 * M),
        dependencies: z.array(K.dependencySchema).max(2000),
        purpose: K.purposeSchema,
      })
      .strict()
      .parse(input);
    const deps = await this.check({
      spaceId: p.spaceId,
      dependencies: p.dependencies,
      purpose: p.purpose,
      exactPolicy: true,
    });
    const row = await this.put(p.spaceId, decode(p.data, 16 * M), 'derived', deps);
    await this.check({ spaceId: p.spaceId, dependencies: deps, purpose: p.purpose, exactPolicy: true });
    return row;
  }
  async readBlob(input: { spaceId: string; id: string; purpose: K.Purpose }) {
    const p = K.scopeSchema.extend({ id: K.kid, purpose: K.purposeSchema }).strict().parse(input);
    const s = await this.state();
    this.require(s, p.spaceId);
    const row = s.blobs.find((v) => v.id === p.id && v.spaceId === p.spaceId && v.state === 'ready');
    if (!row) fail('KNOWLEDGE_NOT_FOUND', '字节不可用', 404);
    let originalSource: K.Source | undefined;
    if (row.kind === 'source') {
      const source = s.sources.find((v) => v.blobId === row.id);
      if (!source) fail('KNOWLEDGE_NOT_FOUND', '未提交来源不可读取', 404);
      originalSource = this.source(s, {
        spaceId: p.spaceId,
        ...{ id: source.id, revision: source.revision },
        purpose: p.purpose,
      });
    } else if (row.owner !== consumer()) fail('SOURCE_USE_REVOKED', '派生字节只向真实写入消费者开放', 403);
    await this.check({ spaceId: p.spaceId, dependencies: row.dependencies, purpose: p.purpose });
    const bytes = await this.io('read', join(this.root, row.id), row.bytes, () =>
      readFile(join(this.root, row.id)),
    );
    if (sha(bytes) !== row.digest || bytes.length !== row.bytes) fail('CITATION_MISMATCH', '字节校验失败');
    await this.check({ spaceId: p.spaceId, dependencies: row.dependencies, purpose: p.purpose });
    if (originalSource) {
      const current = await this.getSource({
        spaceId: p.spaceId,
        id: originalSource.id,
        revision: originalSource.revision,
        purpose: p.purpose,
      });
      if (current.policyRevision !== originalSource.policyRevision)
        fail('SOURCE_USE_REVOKED', '读取期间来源许可改变', 403);
    }
    return { data: bytes.toString('base64'), receipt: row };
  }
  private hold(input: { spaceId: string; id: string; holder: string }, add: boolean) {
    const p = K.scopeSchema
      .extend({ id: K.kid, holder: z.string().min(1).max(160) })
      .strict()
      .parse(input);
    const holder = consumer() + ':' + p.holder;
    return this.change((s) => {
      this.require(s, p.spaceId, true);
      const b = s.blobs.find((b) => b.id === p.id && b.spaceId === p.spaceId);
      if (!b) fail('KNOWLEDGE_NOT_FOUND', '字节不存在', 404);
      if (add && !b.holds.includes(holder)) b.holds.push(holder);
      if (!add) b.holds = b.holds.filter((h) => h !== holder);
      return b;
    }, !add);
  }
  retain(input: { spaceId: string; id: string; holder: string }) {
    return this.hold(input, true);
  }
  release(input: { spaceId: string; id: string; holder: string }) {
    return this.hold(input, false);
  }
  async planCleanup(input: { spaceId: string }) {
    const p = K.scopeSchema.parse(input),
      s = await this.state();
    this.require(s, p.spaceId, true);
    const blobs = s.blobs.filter((b) => b.spaceId === p.spaceId);
    return this.plans.create(
      p.spaceId,
      { ids: blobs.filter((b) => !b.holds.length).map((b) => b.id) },
      blobs.map((b) => `${b.id}: ${b.holds.length ? b.holds.join(', ') : '可清理'}`),
      true,
    );
  }
  async cleanup(input: { spaceId: string; token: string }) {
    const p = await this.plans.consume(
      input.spaceId,
      input.token,
      z.object({ ids: z.array(K.kid) }).strict(),
    );
    const removed: string[] = [],
      protectedIds: string[] = [],
      pending: string[] = [];
    for (const id of p.ids) {
      const b = await this.change((s) => {
        const b = s.blobs.find((b) => b.id === id && b.spaceId === input.spaceId);
        if (!b || b.holds.length) return null;
        b.state = 'retiring';
        return b;
      }, true);
      if (!b) {
        protectedIds.push(id);
        continue;
      }
      try {
        await unlink(join(this.root, id));
        await this.change((s) => {
          s.blobs = s.blobs.filter((v) => v.id !== id);
          s.capacity = s.capacity.filter((c) => c.token !== b.reservation);
        }, true);
        removed.push(id);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          await this.change((s) => {
            s.blobs = s.blobs.filter((v) => v.id !== id);
            s.capacity = s.capacity.filter((c) => c.token !== b.reservation);
          }, true);
          removed.push(id);
        } else {
          await this.change((s) => {
            s.blobs.find((v) => v.id === id)!.state = 'cleanup-pending';
          }, true);
          pending.push(id);
        }
      }
    }
    return { removed, protected: protectedIds, pending };
  }
  async planCapture(input: Parameters<KnowledgeSourcesV1['planCapture']>[0]) {
    const p = K.scopeSchema
      .extend({
        request: captureRequestSchema,
        policy: K.policySchema,
        refresh: captureRefreshSchema.optional(),
      })
      .strict()
      .parse(input);
    await this.space({ spaceId: p.spaceId });
    if (!this.files) fail('FILES_CAPTURE_UNAVAILABLE', '项目捕获需要 FilesV2', 503);
    const refresh = p.refresh ?? [];
    if (
      new Set(refresh.map((r) => r.path)).size !== refresh.length ||
      new Set(refresh.map((r) => r.sourceId)).size !== refresh.length
    )
      fail('REVISION_CONFLICT', '刷新映射重复');
    for (const r of refresh) {
      if (!p.request.relativePaths.includes(r.path)) fail('SOURCE_CHANGED', '刷新映射不在捕获路径中');
      const source = await this.getSource({
        spaceId: p.spaceId,
        id: r.sourceId,
        revision: r.expectedRevision,
        purpose: 'read',
      });
      if (hash(source.policy) !== hash(p.policy))
        fail('REVISION_CONFLICT', '刷新不能更改许可，请先使用许可计划');
    }
    const plan = await this.files.planCapture(p.request);
    return this.plans.create(
      p.spaceId,
      { planToken: plan.token, manifestDigest: plan.manifestDigest, policy: p.policy, refresh },
      plan.files.map((f) => `${f.path} (${f.bytes} B) ${f.sha256}`),
    );
  }
  async capture(input: { spaceId: string; token: string }, signal?: AbortSignal) {
    const p = await this.plans.consume(
      input.spaceId,
      input.token,
      z
        .object({
          planToken: K.kid,
          manifestDigest: K.digest,
          policy: K.policySchema,
          refresh: captureRefreshSchema,
        })
        .strict(),
    );
    if (!this.files) fail('FILES_CAPTURE_UNAVAILABLE', '项目捕获需要 FilesV2', 503);
    const receipt = await this.files.capture({ planToken: p.planToken }, signal);
    try {
      if (receipt.manifestDigest !== p.manifestDigest) fail('SOURCE_CHANGED', '捕获清单不同于预览');
      const ready: { path: string; bytes: Buffer }[] = [];
      for (const file of receipt.files) {
        signal?.throwIfAborted();
        const chunks: Buffer[] = [];
        let offset = 0;
        while (offset < file.bytes) {
          const part = await this.files.readCaptured(
            receipt.token,
            file.path,
            offset,
            Math.min(256 * 1024, file.bytes - offset),
          );
          const chunk = Buffer.from(part.data, 'base64');
          if (!chunk.length) fail('SOURCE_CHANGED', '捕获缺少分块');
          chunks.push(chunk);
          offset += chunk.length;
        }
        const bytes = Buffer.concat(chunks);
        if (sha(bytes) !== file.sha256) fail('SOURCE_CHANGED', '捕获字节不一致');
        ready.push({ path: file.path, bytes });
      }
      const out: K.Source[] = [];
      for (const item of ready) {
        signal?.throwIfAborted();
        const ext = item.path.split('.').at(-1)?.toLowerCase();
        const format: K.Source['format'] =
          ext === 'md'
            ? 'markdown'
            : ext === 'json'
              ? 'json'
              : ext === 'csv'
                ? 'csv'
                : ext === 'html' || ext === 'htm'
                  ? 'html'
                  : 'text';
        if (item.bytes.length > 8 * M || /\.(pdf|docx?|xlsx?|pptx?|zip|exe|dll|png|svg)$/i.test(item.path))
          fail('SOURCE_FORMAT_UNSUPPORTED', '捕获包含不支持或超过 8 MiB 的材料', 415);
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(item.bytes);
        } catch {
          fail('SOURCE_FORMAT_UNSUPPORTED', '捕获材料不是 UTF-8', 415);
        }
        if (text.includes('\0')) fail('SOURCE_FORMAT_UNSUPPORTED', '捕获材料包含二进制字节', 415);
        const blob = await this.put(input.spaceId, item.bytes, 'source', []);
        const mapping = p.refresh.find((r) => r.path === item.path),
          previous = mapping
            ? await this.getSource({
                spaceId: input.spaceId,
                id: mapping.sourceId,
                revision: mapping.expectedRevision,
                purpose: 'read',
              })
            : undefined;
        out.push({
          ...base(input.spaceId, {}, [], mapping?.sourceId, (mapping?.expectedRevision ?? 0) + 1),
          digest: blob.digest,
          name: item.path.split('/').at(-1)!,
          format,
          bytes: blob.bytes,
          blobId: blob.id,
          origin: 'project',
          originDigest: receipt.manifestDigest,
          policy: p.policy,
          policyRevision: previous?.policyRevision ?? 1,
          revoked: false,
          sensitive: sensitive(text),
          redactions: [],
        });
      }
      // 整批来源最后一次原子提交；中断只留下可清理的无引用字节。 Commit the whole selected set atomically.
      await this.change((s) => {
        signal?.throwIfAborted();
        this.require(s, input.spaceId);
        const existing = s.sources.filter((r) => r.spaceId === input.spaceId);
        if (
          new Set([...existing, ...out].map((r) => r.id)).size > 2000 ||
          existing.reduce((n, r) => n + r.bytes, 0) + out.reduce((n, r) => n + r.bytes, 0) > 2 * 1024 ** 3
        )
          fail('KNOWLEDGE_QUOTA', '捕获整批超过空间预算', 413);
        for (const row of out) {
          const old = existing.filter((r) => r.id === row.id).at(-1);
          if (
            (old?.revision ?? 0) !== row.revision - 1 ||
            (old &&
              (old.revoked ||
                old.policyRevision !== row.policyRevision ||
                hash(old.policy) !== hash(row.policy)))
          )
            fail('SOURCE_CHANGED', '刷新目标在捕获期间改变');
          s.sources.push(K.sourceSchema.parse(row));
          s.blobs.find((b) => b.id === row.blobId)!.holds.push(`source:${row.id}:${row.revision}`);
        }
      });
      return out;
    } finally {
      await this.files.releaseCapture(receipt.token);
    }
  }
  async close() {
    await this.tail;
  }
}
