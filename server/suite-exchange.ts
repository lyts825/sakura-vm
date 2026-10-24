/** 完整对象图的有界交换；隔离接受后生成新 ID，外来结果保持参考性质。 */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import * as S from '../shared/contracts/suite-common.ts';
import { suiteCanonical, suiteHash, suiteSha, suiteFail, type SuiteAuthorize } from './suite-store.ts';
import { SuiteQuarantineExchange } from './suite-quarantine.ts';
import { SuiteMaterials } from './suite-materials.ts';
import { encodeSuiteBundle, decodeSuiteBundle, SUITE_BUNDLE_LIMIT } from '../scripts/suite-bundle.mjs';
import { parseSuiteJson } from '../shared/suite-json.ts';

const key = (r: S.SuiteRef) => `${r.domain}:${r.id}:${r.revision}`;
const reference = (r: S.SuiteRecord): S.SuiteRef => ({ domain: r.domain, id: r.id, revision: r.revision });
const objectPath = (r: S.SuiteRef) => `objects/${r.domain}/${r.id}-${r.revision}.json`;
const materialPath = (r: S.SuiteRef) => `materials/${r.id}-${r.revision}.bin`;
const transferInput = S.suiteScope.extend({ id: S.suiteId }).strict();
const exportContent = z
  .object({
    format: z.literal('sakura-suite-export/1'),
    bundle: S.suiteRef,
    bytes: z.number().int().min(0),
    digest: S.suiteDigest,
    manifestDigest: S.suiteDigest,
    sourceTrust: z.literal('unauthenticated'),
    objects: z.number().int().positive(),
  })
  .strict();
const importContent = z
  .object({
    format: z.literal('sakura-suite-import/1'),
    bundle: S.suiteRef,
    bytes: z.number().int().min(0),
    digest: S.suiteDigest,
    manifestDigest: S.suiteDigest,
    sourceTrust: z.literal('unauthenticated'),
    objects: z.number().int().positive(),
    state: z.literal('quarantined'),
  })
  .strict();
type Graph = { rows: S.SuiteRecord[]; material: Map<string, Buffer>; manifestDigest: string };
const receiptContent = z
  .object({
    format: z.literal('sakura-suite-receipt/1'),
    planId: S.suiteId,
    workspaceId: S.suiteId,
    manifestDigest: S.suiteDigest,
    sourceTrust: z.literal('unauthenticated'),
    mapping: z
      .array(z.object({ from: z.string().min(1).max(200), to: S.suiteRef }).strict())
      .min(1)
      .max(1000),
    state: z.enum(['staged', 'accepted']),
    approvalsTransferred: z.literal(false),
    workspacePolicyRevision: z.number().int().positive().optional(),
  })
  .strict();
const receiptInput = S.suiteScope.extend({ receipt: S.suiteRef }).strict();
const acceptedSnapshot = z
  .object({
    workspaceRevision: z.number().int().positive(),
    mappingDigest: S.suiteDigest,
    guards: z
      .array(
        z
          .object({
            reference: S.suiteRef,
            policyRevision: z.number().int().positive(),
            policyDigest: S.suiteDigest,
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export class SuiteExchange extends SuiteQuarantineExchange {
  private files: SuiteMaterials;
  constructor(
    domain: string,
    metadata: PluginMetadata,
    blobMetadata: PluginMetadata,
    uploads: PluginMetadata,
    auth: SuiteAuthorize,
    sources: S.SuiteMaterialsV1,
    peers: Readonly<Record<string, S.SuiteRecordsV1>>,
    private format: string,
    private sanitize: (domain: string, kind: S.SuiteRecord['kind'], value: S.SuiteJson) => S.SuiteJson,
    private options: { sourceDomain?: string; receivedName?: string } = {},
  ) {
    super(domain, metadata, auth, sources, peers);
    this.files = new SuiteMaterials(
      domain,
      blobMetadata,
      uploads,
      auth,
      2 * 1024 ** 3,
      SUITE_BUNDLE_LIMIT,
      ['bundle'],
      sources,
    );
  }
  private peer(domain: string) {
    return (
      (Object.hasOwn(this.peers, domain) ? this.peers[domain] : undefined) ??
      suiteFail('SUITE_BUNDLE_DOMAIN', '包内对象不属于已声明的领域')
    );
  }
  private async bytes(
    store: S.SuiteMaterialsV1,
    scope: S.SuiteScope,
    ref: S.SuiteRef,
    purpose: 'read' | 'export',
  ) {
    const row = await store.get({ ...scope, id: ref.id, revision: ref.revision }),
      material = S.suiteMaterial.parse(row.content);
    if (material.bytes > SUITE_BUNDLE_LIMIT) suiteFail('SUITE_BUNDLE_LIMIT', '本版交接包最多 16 MiB', 413);
    const buffers: Buffer[] = [];
    for (let offset = 0; offset < material.bytes;) {
      const part = await store.readSource({
        ...scope,
        id: ref.id,
        revision: ref.revision,
        offset,
        length: Math.min(512 * 1024, material.bytes - offset),
        purpose,
      });
      const data = Buffer.from(part.data, 'base64');
      if (!data.length || part.offset !== offset + data.length) suiteFail('SUITE_MATERIAL_PROTOCOL');
      buffers.push(data);
      offset = part.offset;
    }
    if (!material.bytes)
      await store.readSource({ ...scope, id: ref.id, revision: ref.revision, offset: 0, length: 1, purpose });
    const result = Buffer.concat(buffers);
    if (suiteSha(result) !== material.digest) suiteFail('SUITE_MATERIAL_DIGEST');
    return result;
  }
  private async storeBytes(scope: S.SuiteScope, name: string, bytes: Buffer) {
    const upload = await this.files.beginUpload({
      ...scope,
      name,
      format: 'bundle',
      bytes: bytes.length,
      digest: suiteSha(bytes),
      allowExport: true,
    });
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
      await this.files.appendUpload({
        ...scope,
        id: upload.id,
        offset,
        data: bytes.subarray(offset, offset + 512 * 1024).toString('base64'),
      });
    return this.files.finishUpload({ ...scope, id: upload.id });
  }
  async previewExport(raw: unknown) {
    const input = S.suiteScope
      .extend({ references: z.array(S.suiteRef).min(1).max(1000) })
      .strict()
      .parse(raw);
    const selected = input.references;
    const graph = await this.collect({ workspaceId: input.workspaceId }, selected);
    return this.plan(
      { workspaceId: input.workspaceId },
      'export',
      S.suiteJson.parse({
        references: selected,
        manifestDigest: graph.manifest.digest,
        bytes: graph.data.length,
      }),
      selected,
    );
  }
  private async collect(scope: S.SuiteScope, selected: S.SuiteRef[]) {
    const records = new Map<string, S.SuiteRecord>(),
      pending = new Set<string>();
    const visit = async (ref: S.SuiteRef) => {
      if (records.has(key(ref))) return;
      if (pending.has(key(ref)) || records.size + pending.size >= 1000) suiteFail('SUITE_BUNDLE_GRAPH');
      pending.add(key(ref));
      const row = await this.peer(ref.domain).get({ ...scope, id: ref.id, revision: ref.revision });
      if (row.workspaceId !== scope.workspaceId || row.state === 'draft') suiteFail('SUITE_BUNDLE_UNSEALED');
      for (const dependency of row.references) await visit(dependency);
      pending.delete(key(ref));
      records.set(key(ref), row);
    };
    for (const ref of selected) await visit(ref);
    const entries: { path: string; data: Uint8Array }[] = [];
    let size = 0;
    for (const record of records.values()) {
      const payload = Buffer.from(suiteCanonical(record));
      size += payload.length + 1024;
      if (record.kind === 'source') size += S.suiteMaterial.parse(record.content).bytes;
      if (size > SUITE_BUNDLE_LIMIT - 128 * 1024)
        suiteFail('SUITE_BUNDLE_LIMIT', '完整交接材料超过 16 MiB', 413);
      entries.push({ path: objectPath(reference(record)), data: payload });
      if (record.kind === 'source') {
        if (record.domain !== this.sourcesDomain()) suiteFail('SUITE_BUNDLE_SOURCE_DOMAIN');
        entries.push({
          path: materialPath(reference(record)),
          data: await this.bytes(this.sources, scope, reference(record), 'export'),
        });
      }
    }
    return encodeSuiteBundle(this.format, entries);
  }
  private sourcesDomain() {
    return this.options.sourceDomain ?? this.domain.split('-')[0] + '-sources';
  }
  protected override sourcesDomainForQuarantine(): string {
    return this.sourcesDomain();
  }
  protected override async releaseOwned(scope: S.SuiteScope, record: S.SuiteRecord): Promise<void> {
    return this.serializeTransfer(() => this.releaseOwnedTransfer(scope, record));
  }
  private async releaseOwnedTransfer(scope: S.SuiteScope, record: S.SuiteRecord): Promise<void> {
    if (!record.content || typeof record.content !== 'object' || Array.isArray(record.content)) return;
    if (!['sakura-suite-export/1', 'sakura-suite-import/1'].includes(String(record.content.format))) return;
    const bundle = S.suiteRef.parse(record.content.bundle);
    const others = (await this.readState()).rows.filter(
      (r) => r.workspaceId === scope.workspaceId && r.revision !== record.revision,
    );
    if (
      others.some(
        (r) =>
          r.content &&
          typeof r.content === 'object' &&
          !Array.isArray(r.content) &&
          r.content.bundle &&
          suiteHash(r.content.bundle) === suiteHash(bundle),
      )
    )
      suiteFail('SUITE_CONTENT_PROTECTED');
    await this.files.dropPrivateSource({ ...scope, id: bundle.id, revision: bundle.revision });
  }
  async export(raw: S.SuiteApproval) {
    return this.serializeTransfer(() => this.exportTransfer(raw));
  }
  private async exportTransfer(raw: S.SuiteApproval) {
    const plan = await this.consume(raw, 'export'),
      scope = { workspaceId: plan.workspaceId };
    if (plan.state === 'completed' && plan.result)
      return this.get({ ...scope, id: plan.result.id, revision: plan.result.revision });
    const selection = z
      .object({
        references: z.array(S.suiteRef),
        manifestDigest: S.suiteDigest,
        bytes: z.number().int().positive(),
      })
      .strict()
      .parse(plan.input);
    const archive = await this.collect(scope, selection.references);
    if (archive.manifest.digest !== selection.manifestDigest || archive.data.length !== selection.bytes)
      suiteFail('SUITE_EXPORT_CHANGED');
    const stored = await this.storeBytes(scope, '交接包.zip', archive.data);
    const row = await this.put(
      {
        ...scope,
        name: '完整交接包',
        references: selection.references,
        content: {
          format: 'sakura-suite-export/1',
          bundle: reference(stored),
          bytes: archive.data.length,
          digest: suiteSha(archive.data),
          manifestDigest: archive.manifest.digest,
          sourceTrust: 'unauthenticated',
          objects: archive.manifest.files.filter((f) => f.path.startsWith('objects/')).length,
        },
      },
      'result',
      true,
    );
    await this.complete(plan, row);
    return row;
  }
  async download(raw: S.SuitePin & { offset: number; length: number }) {
    const input = S.suitePin
      .extend({
        offset: z.number().int().min(0),
        length: z
          .number()
          .int()
          .positive()
          .max(512 * 1024),
      })
      .strict()
      .parse(raw);
    const row = await this.get({ workspaceId: input.workspaceId, id: input.id, revision: input.revision });
    if (row.state !== 'sealed') suiteFail('SUITE_EXPORT_ARCHIVED');
    const guards = await this.exportPermissions({ workspaceId: input.workspaceId }, row.references);
    const content = exportContent.parse(row.content);
    const result = await this.files.readSource({
      workspaceId: input.workspaceId,
      id: content.bundle.id,
      revision: content.bundle.revision,
      offset: input.offset,
      length: input.length,
      purpose: 'export',
    });
    for (const guard of guards) {
      const current = await this.sources.policy({
        workspaceId: input.workspaceId,
        id: guard.ref.id,
        revision: guard.ref.revision,
      });
      if (!current.allowRead || !current.allowExport || current.revision !== guard.revision)
        suiteFail('SUITE_SOURCE_PERMISSION', '原材料导出许可已改变', 403);
    }
    return result;
  }
  private async exportPermissions(scope: S.SuiteScope, references: S.SuiteRef[]) {
    const visited = new Set<string>(),
      guards: { ref: S.SuiteRef; revision: number }[] = [];
    const visit = async (ref: S.SuiteRef) => {
      if (visited.has(key(ref))) return;
      if (visited.size >= 1000) suiteFail('SUITE_BUNDLE_GRAPH');
      visited.add(key(ref));
      const row = await this.fixed(scope, ref);
      if (row.kind === 'source') {
        if (row.domain !== this.sourcesDomain()) suiteFail('SUITE_BUNDLE_SOURCE_DOMAIN');
        const policy = await this.sources.policy({ ...scope, id: row.id, revision: row.revision });
        if (!policy.allowRead || !policy.allowExport)
          suiteFail('SUITE_SOURCE_PERMISSION', '原材料当前禁止导出', 403);
        guards.push({ ref, revision: policy.revision });
      }
      for (const dependency of row.references) await visit(dependency);
    };
    for (const ref of references) await visit(ref);
    return guards;
  }
  async beginImport(raw: unknown) {
    return this.serializeTransfer(() => this.beginTransfer(raw));
  }
  private async beginTransfer(raw: unknown) {
    const input = S.suiteScope
      .extend({
        name: S.suiteName,
        bytes: z.number().int().positive().max(SUITE_BUNDLE_LIMIT),
        digest: S.suiteDigest,
      })
      .strict()
      .parse(raw);
    return this.files.beginUpload({ ...input, format: 'bundle', allowExport: false });
  }
  async appendImport(input: S.SuiteScope & { id: string; offset: number; data: string }) {
    return this.serializeTransfer(() => this.files.appendUpload(input));
  }
  async transfers(raw: S.SuiteScope) {
    return this.files.uploads(S.suiteScope.parse(raw));
  }
  async discardImport(raw: S.SuiteScope & { id: string }): Promise<S.SuiteUpload> {
    const input = transferInput.parse(raw),
      scope = { workspaceId: input.workspaceId };
    return this.serializeTransfer(async () => {
      const upload = (await this.files.uploads(scope)).find((row) => row.id === input.id);
      if (!upload) suiteFail('SUITE_UPLOAD_NOT_FOUND', '传输不存在', 404);
      if (upload.state === 'discarded') return upload;
      if (!upload.source) return this.files.discardUpload(input);
      if (
        (await this.readState()).rows.some(
          (row) =>
            row.workspaceId === scope.workspaceId &&
            row.content &&
            typeof row.content === 'object' &&
            !Array.isArray(row.content) &&
            row.content.bundle &&
            suiteHash(row.content.bundle) === suiteHash(upload.source),
        )
      )
        suiteFail('SUITE_TRANSFER_PROTECTED', '材料已有交接记录，请先归档并清理对应记录');
      await this.files.dropPrivateSource({
        ...scope,
        id: upload.source.id,
        revision: upload.source.revision,
      });
      return (await this.files.uploads(scope)).find((row) => row.id === input.id)!;
    });
  }
  private validate(data: Buffer): Graph {
    let decoded: ReturnType<typeof decodeSuiteBundle>;
    try {
      decoded = decodeSuiteBundle(data, this.format);
    } catch {
      suiteFail('SUITE_BUNDLE_INVALID', '交接包结构或摘要无效', 400);
    }
    const material = new Map<string, Buffer>(),
      rows: S.SuiteRecord[] = [],
      used = new Set<string>();
    for (const entry of decoded.entries.filter((e) => e.path.startsWith('objects/'))) {
      if (entry.data.length > 8 * 1024 ** 2) suiteFail('SUITE_OBJECT_LIMIT');
      const parsed: unknown = parseSuiteJson(
        new TextDecoder('utf-8', { fatal: true }).decode(entry.data),
        8 * 1024 ** 2,
      );
      if (!S.isSuiteJsonBounded(parsed, 32)) suiteFail('SUITE_OBJECT_LIMIT', '导入对象结构超出限制', 413);
      const row = S.suiteRecord.parse(parsed);
      if (
        entry.path !== objectPath(reference(row)) ||
        !Object.hasOwn(this.peers, row.domain) ||
        row.state === 'draft'
      )
        suiteFail('SUITE_BUNDLE_OBJECT');
      if (
        row.revision !==
        suiteHash({
          id: row.id,
          parent: row.parent,
          sequence: row.sequence,
          content: row.content,
          references: row.references,
        })
      )
        suiteFail('SUITE_BUNDLE_REVISION');
      rows.push(row);
      used.add(entry.path);
      if (row.kind === 'source') {
        if (row.domain !== this.sourcesDomain()) suiteFail('SUITE_BUNDLE_SOURCE_DOMAIN');
        const metadata = S.suiteMaterial.parse(row.content),
          path = materialPath(reference(row)),
          bytes = decoded.entries.find((e) => e.path === path)?.data;
        if (!bytes || bytes.length !== metadata.bytes || suiteSha(bytes) !== metadata.digest)
          suiteFail('SUITE_BUNDLE_MATERIAL');
        material.set(key(reference(row)), bytes);
        used.add(path);
      }
    }
    if (
      !rows.length ||
      rows.length > 1000 ||
      new Set(rows.map((r) => r.workspaceId)).size !== 1 ||
      used.size !== decoded.entries.length
    )
      suiteFail('SUITE_BUNDLE_GRAPH');
    const byKey = new Map(rows.map((r) => [key(reference(r)), r]));
    if (byKey.size !== rows.length) suiteFail('SUITE_BUNDLE_DUPLICATE');
    const ordered: S.SuiteRecord[] = [],
      done = new Set<string>(),
      active = new Set<string>();
    const visit = (row: S.SuiteRecord) => {
      const id = key(reference(row));
      if (done.has(id)) return;
      if (active.has(id)) suiteFail('SUITE_BUNDLE_CYCLE');
      active.add(id);
      for (const ref of row.references) {
        const target = byKey.get(key(ref));
        if (!target) suiteFail('SUITE_BUNDLE_DANGLING');
        visit(target);
      }
      active.delete(id);
      done.add(id);
      ordered.push(row);
    };
    rows.forEach(visit);
    return { rows: ordered, material, manifestDigest: decoded.manifest.digest };
  }
  async inspectImport(raw: unknown) {
    return this.serializeTransfer(() => this.inspectTransfer(raw));
  }
  private async inspectTransfer(raw: unknown) {
    const input = transferInput.parse(raw),
      scope = { workspaceId: input.workspaceId };
    const stored = await this.files.finishUpload(input),
      buffer = await this.bytes(this.files, scope, reference(stored), 'read'),
      graph = this.validate(buffer);
    const inspection = await this.put(
      {
        ...scope,
        name: '隔离交接材料',
        references: [],
        content: {
          format: 'sakura-suite-import/1',
          bundle: reference(stored),
          bytes: buffer.length,
          digest: suiteSha(buffer),
          manifestDigest: graph.manifestDigest,
          sourceTrust: 'unauthenticated',
          objects: graph.rows.length,
          state: 'quarantined',
        },
      },
      'import',
      true,
    );
    const plan = await this.plan(
      scope,
      'accept-import',
      { inspection: reference(inspection), manifestDigest: graph.manifestDigest },
      [reference(inspection)],
    );
    return { inspection, plan };
  }
  private remap(value: S.SuiteJson, ids: Map<string, S.SuiteRef>): S.SuiteJson {
    if (Array.isArray(value)) return value.map((v) => this.remap(v, ids));
    if (value && typeof value === 'object') {
      if (Object.keys(value).sort().join(',') === 'domain,id,revision') {
        const parsed = S.suiteRef.safeParse(value);
        if (parsed.success && ids.has(key(parsed.data))) return ids.get(key(parsed.data))!;
      }
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, this.remap(item, ids)]));
    }
    return value;
  }
  async acceptImport(raw: S.SuiteApproval) {
    return this.serializeTransfer(() => this.acceptTransfer(raw));
  }
  private async acceptTransfer(raw: S.SuiteApproval) {
    const plan = await this.consume(raw, 'accept-import'),
      originalScope = { workspaceId: plan.workspaceId };
    if (plan.state === 'completed' && plan.result)
      return this.get({ ...originalScope, id: plan.result.id, revision: plan.result.revision });
    const input = z
      .object({ inspection: S.suiteRef, manifestDigest: S.suiteDigest })
      .strict()
      .parse(plan.input);
    const inspection = importContent.parse(
      (await this.get({ ...originalScope, id: input.inspection.id, revision: input.inspection.revision }))
        .content,
    );
    const bytes = await this.bytes(this.files, originalScope, inspection.bundle, 'read'),
      graph = this.validate(bytes);
    if (suiteSha(bytes) !== inspection.digest || graph.manifestDigest !== input.manifestDigest)
      suiteFail('SUITE_IMPORT_CHANGED');
    let receipt: S.SuiteRecord | undefined;
    const accepted = await this.sources.acceptWorkspace(
      { name: this.options.receivedName ?? '接收的档案' },
      async (destination) => {
        const ids = new Map<string, S.SuiteRef>();
        for (const row of graph.rows) {
          let result: S.SuiteRecord;
          if (row.kind === 'source') {
            const data = graph.material.get(key(reference(row)))!,
              material = S.suiteMaterial.parse(row.content);
            const upload = await this.sources.beginUpload({
              ...destination,
              name: row.name,
              format: S.suiteUploadInput.shape.format.parse(material.format),
              bytes: data.length,
              digest: suiteSha(data),
              allowExport: false,
            });
            for (let offset = 0; offset < data.length; offset += 512 * 1024)
              await this.sources.appendUpload({
                ...destination,
                id: upload.id,
                offset,
                data: data.subarray(offset, offset + 512 * 1024).toString('base64'),
              });
            result = await this.sources.finishUpload({ ...destination, id: upload.id });
          } else
            result = await this.peer(row.domain).importRecord({
              ...destination,
              name: row.name,
              kind: row.kind,
              content: this.sanitize(row.domain, row.kind, this.remap(row.content, ids)),
              references: row.references.map((r) => ids.get(key(r))!),
            });
          ids.set(key(reference(row)), reference(result));
          if (result.id === row.id) suiteFail('SUITE_IMPORT_ID_REUSED');
        }
        receipt = await this.put(
          {
            ...originalScope,
            name: '接收对象映射',
            references: [input.inspection],
            content: {
              format: 'sakura-suite-receipt/1',
              planId: plan.id,
              workspaceId: destination.workspaceId,
              manifestDigest: graph.manifestDigest,
              sourceTrust: 'unauthenticated',
              mapping: [...ids].map(([from, to]) => ({ from, to })),
              state: 'staged',
              approvalsTransferred: false,
            },
          },
          'result',
          true,
        );
        return reference(receipt);
      },
    );
    if (!receipt || accepted.workspace.id === originalScope.workspaceId) suiteFail('SUITE_IMPORT_FAILED');
    if (!receipt.content || typeof receipt.content !== 'object' || Array.isArray(receipt.content))
      suiteFail('SUITE_IMPORT_FAILED');
    const confirmed = await this.put(
      {
        ...originalScope,
        id: receipt.id,
        expectedRevision: receipt.revision,
        name: receipt.name,
        references: receipt.references,
        content: {
          ...receipt.content,
          state: 'accepted',
          workspacePolicyRevision: accepted.workspace.policyRevision,
        },
      },
      'result',
      true,
    );
    await this.complete(plan, confirmed);
    return confirmed;
  }
  private async verifyAccepted(
    scope: S.SuiteScope,
    receipt: S.SuiteRecord,
  ): Promise<z.infer<typeof acceptedSnapshot>> {
    if (receipt.origin !== 'local' || receipt.domain !== this.domain || receipt.references.length !== 1)
      suiteFail('SUITE_IMPORT_RECEIPT');
    const content = receiptContent.parse(receipt.content),
      inspection = importContent.parse(
        (await this.get({ ...scope, id: receipt.references[0].id, revision: receipt.references[0].revision }))
          .content,
      );
    const target = { workspaceId: content.workspaceId },
      workspace = await this.sources.workspace(target);
    if (workspace.quarantined || workspace.id === scope.workspaceId)
      suiteFail('SUITE_IMPORT_NOT_PUBLISHED', '接收空间尚未发布；可核对隔离空间后重新接收');
    const graph = this.validate(await this.bytes(this.files, scope, inspection.bundle, 'read'));
    if (graph.manifestDigest !== content.manifestDigest || content.mapping.length !== graph.rows.length)
      suiteFail('SUITE_IMPORT_MAPPING');
    const ids = new Map(content.mapping.map((item) => [item.from, item.to]));
    if (
      ids.size !== graph.rows.length ||
      new Set(content.mapping.map((item) => key(item.to))).size !== graph.rows.length
    )
      suiteFail('SUITE_IMPORT_MAPPING');
    const verified: S.SuiteRef[] = [];
    for (const row of graph.rows) {
      const mapped = ids.get(key(reference(row)));
      if (!mapped || mapped.domain !== row.domain || mapped.id === row.id) suiteFail('SUITE_IMPORT_MAPPING');
      const received = await this.peer(mapped.domain).get({
        ...target,
        id: mapped.id,
        revision: mapped.revision,
      });
      if (
        received.state !== 'sealed' ||
        received.kind !== row.kind ||
        received.workspaceId !== target.workspaceId ||
        received.actor !== receipt.actor
      )
        suiteFail('SUITE_IMPORT_MAPPING');
      if (row.kind === 'source') {
        const before = S.suiteMaterial.parse(row.content),
          after = S.suiteMaterial.parse(received.content);
        if (
          received.origin !== 'local' ||
          after.bytes !== before.bytes ||
          after.digest !== before.digest ||
          after.format !== before.format
        )
          suiteFail('SUITE_IMPORT_MAPPING');
        await this.bytes(this.sources, target, mapped, 'read');
      } else {
        if (
          received.origin !== 'imported' ||
          suiteHash(received.content) !==
            suiteHash(this.sanitize(row.domain, row.kind, this.remap(row.content, ids))) ||
          suiteHash(received.references) !== suiteHash(row.references.map((ref) => ids.get(key(ref))!))
        )
          suiteFail('SUITE_IMPORT_MAPPING');
      }
      verified.push(mapped);
    }
    const guards: z.infer<typeof acceptedSnapshot>['guards'] = [];
    for (const ref of verified) {
      const current = await this.peer(ref.domain).get({ ...target, id: ref.id, revision: ref.revision });
      if (current.state !== 'sealed') suiteFail('SUITE_IMPORT_MAPPING');
      guards.push({
        reference: ref,
        policyRevision: current.policyRevision,
        policyDigest: current.authorizationDigest ?? suiteHash(current.policyRevision),
      });
    }
    if ((await this.sources.workspace(target)).policyRevision !== workspace.policyRevision)
      suiteFail('SUITE_POLICY_CHANGED');
    return { workspaceRevision: workspace.policyRevision, mappingDigest: suiteHash(content.mapping), guards };
  }
  async previewImportRecovery(raw: S.SuiteScope & { receipt: S.SuiteRef }): Promise<S.SuitePlan> {
    return this.serializeTransfer(async () => {
      const input = receiptInput.parse(raw),
        scope = { workspaceId: input.workspaceId };
      if (input.receipt.domain !== this.domain) suiteFail('SUITE_IMPORT_RECEIPT');
      const receipt = await this.get({ ...scope, id: input.receipt.id, revision: input.receipt.revision }),
        snapshot = await this.verifyAccepted(scope, receipt);
      return this.plan(
        scope,
        'confirm-import',
        S.suiteJson.parse({
          receipt: input.receipt,
          snapshot,
          createsResources: false,
          approvalsTransferred: false,
        }),
        [input.receipt],
      );
    });
  }
  async recoverImport(raw: S.SuiteApproval): Promise<S.SuiteRecord> {
    return this.serializeTransfer(async () => {
      const plan = await this.consume(raw, 'confirm-import', true),
        scope = { workspaceId: plan.workspaceId };
      if (plan.state === 'completed' && plan.result)
        return this.get({ ...scope, id: plan.result.id, revision: plan.result.revision });
      const input = z
          .object({
            receipt: S.suiteRef,
            snapshot: acceptedSnapshot,
            createsResources: z.literal(false),
            approvalsTransferred: z.literal(false),
          })
          .strict()
          .parse(plan.input),
        receipt = await this.get({ ...scope, id: input.receipt.id, revision: input.receipt.revision });
      const current = await this.verifyAccepted(scope, receipt);
      if (suiteHash(current) !== suiteHash(input.snapshot)) suiteFail('SUITE_IMPORT_CHANGED');
      const content = receiptContent.parse(receipt.content),
        confirmed =
          content.state === 'accepted'
            ? receipt
            : await this.put(
                {
                  ...scope,
                  id: receipt.id,
                  expectedRevision: receipt.revision,
                  name: receipt.name,
                  references: receipt.references,
                  content: S.suiteJson.parse({
                    ...content,
                    state: 'accepted',
                    workspacePolicyRevision: current.workspaceRevision,
                  }),
                },
                'result',
                true,
              );
      await this.complete(plan, confirmed);
      const original = (await this.readState()).plans.find(
        (original) =>
          original.id === content.planId &&
          original.actor === receipt.actor &&
          original.workspaceId === plan.workspaceId &&
          original.action === 'accept-import' &&
          original.state === 'consumed',
      );
      if (original) await this.complete(original, confirmed);
      return confirmed;
    });
  }
  async imports(raw: S.SuiteScope) {
    const scope = S.suiteScope.parse(raw);
    const page = await this.list({ ...scope, limit: 100 });
    return page.items.filter(
      (r) =>
        r.kind === 'import' ||
        (typeof r.content === 'object' &&
          r.content !== null &&
          !Array.isArray(r.content) &&
          r.content.format === 'sakura-suite-receipt/1'),
    );
  }
  override async close() {
    await this.transferTail;
    await this.files.close();
    await super.close();
  }
}
