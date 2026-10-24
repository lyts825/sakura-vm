/** 隔离核验、依赖闭包和可恢复逐领域接受。 Quarantine verification and resumable domain publication. */
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, lstat, open, readFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { metadataPath } from './plugin-metadata.ts';
import type { IntegrationMetadataFactory } from './integration-specs.ts';
// 独立运行包共用纯 Node ZIP 校验器，不加载外部代码。 Shared offline decoder is a shipped fixed asset.
// @ts-expect-error JavaScript runtime asset has no TypeScript declaration.
import { readIntegrationZip } from '../scripts/integration-verify.mjs';
import type * as Ports from './service-contracts/integration-lab.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { IntegrationRows, ilHash, ilBytes, ilFail, ilIdentity, ilSealed } from './integration-store.ts';
import {
  integrationBundleSchema,
  integrationImportSchema,
  integrationPortableReportSchema,
  integrationUploadSchema,
  type IntegrationBundle,
} from '../shared/contracts/integration-exchange.ts';
import {
  httpContractSchema,
  environmentSchema,
  fixtureSchema,
  mockSchema,
  scenarioSchema,
  assertionSchema,
  type IntegrationScope,
  type IntegrationRef,
  type IntegrationJson,
} from '../shared/contracts/integration-lab.ts';
type Deps = {
  specs: Ports.IntegrationSpecsV1;
  environments: Ports.IntegrationEnvironmentsV1;
  fixtures: Ports.IntegrationFixturesV1;
  mocks: Ports.IntegrationMocksV1;
  scenarios: Ports.IntegrationScenariosV1;
  assertions: Ports.IntegrationAssertionsV1;
  reports: Ports.IntegrationReportsV1;
};
const key = (ref: IntegrationRef) => ilHash(ref);
export function verifyIntegrationBundle(raw: unknown) {
  const bundle = integrationBundleSchema.parse(raw);
  const { digest, ...core } = bundle;
  if (ilHash(core) !== digest) ilFail('BUNDLE_DIGEST');
  let bytes = 0;
  const keys = new Set<string>(),
    paths = new Set<string>();
  for (const e of bundle.entries) {
    if (
      keys.has(e.key) ||
      paths.has(e.path.toLowerCase()) ||
      e.path !== e.kind + '/' + e.key + '.json' ||
      ilHash(e.content) !== e.digest ||
      ilBytes(e.content) !== e.bytes
    )
      ilFail('BUNDLE_ENTRY_INVALID');
    keys.add(e.key);
    paths.add(e.path.toLowerCase());
    bytes += e.bytes;
    switch (e.kind) {
      case 'spec':
        httpContractSchema.parse(e.content);
        break;
      case 'environment': {
        const env = environmentSchema.parse(e.content);
        if (
          env.target.kind !== 'unbound' ||
          env.application ||
          env.credentials.some((c) => c.sourceVmId || c.name || c.version)
        )
          ilFail('BUNDLE_AUTHORITY_FORBIDDEN');
        break;
      }
      case 'fixture':
        fixtureSchema.parse(e.content);
        break;
      case 'mock':
        mockSchema.parse(e.content);
        break;
      case 'scenario':
        scenarioSchema.parse(e.content);
        break;
      case 'assertion':
        assertionSchema.parse(e.content);
        break;
      case 'report':
        integrationPortableReportSchema.parse(e.content);
        break;
    }
  }
  if (bytes > 512 * 1024 ** 2) ilFail('BUNDLE_SIZE');
  for (const k of [bundle.root.scenario, bundle.root.assertions, bundle.root.mock].filter(Boolean))
    if (!keys.has(k!)) ilFail('BUNDLE_CLOSURE_MISSING');
  const has = (ref: IntegrationRef, kind: string) => {
    if (!bundle.entries.some((e) => e.key === key(ref) && e.kind === kind)) ilFail('BUNDLE_CLOSURE_MISSING');
  };
  for (const entry of bundle.entries) {
    if (entry.kind === 'mock') {
      const v = mockSchema.parse(entry.content);
      has(v.contract, 'spec');
      v.fixtures.forEach((ref) => has(ref, 'fixture'));
    } else if (entry.kind === 'scenario') {
      const v = scenarioSchema.parse(entry.content);
      has(v.contract, 'spec');
      has(v.environment, 'environment');
      v.fixtures.forEach((ref) => has(ref, 'fixture'));
    } else if (entry.kind === 'assertion') has(assertionSchema.parse(entry.content).scenario, 'scenario');
  }
  for (const [k, kind] of [
    [bundle.root.scenario, 'scenario'],
    [bundle.root.assertions, 'assertion'],
    [bundle.root.mock, 'mock'],
  ])
    if (k && !bundle.entries.some((e) => e.key === k && e.kind === kind)) ilFail('BUNDLE_ROOT_KIND');
  return bundle;
}
export class IntegrationExchange implements Ports.IntegrationExchangeV1 {
  private rows;
  private transferRows;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private meta: IntegrationMetadataFactory,
    private d: Deps,
  ) {
    this.rows = new IntegrationRows(meta('imports'), integrationImportSchema);
    this.transferRows = new IntegrationRows(meta('uploads'), integrationUploadSchema);
  }
  private async uploadFile(id: string) {
    z.uuid().parse(id);
    const root = join(dirname(metadataPath(this.meta('uploads'))), 'integration-content');
    await mkdir(root, { recursive: true });
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) ilFail('UPLOAD_PATH_INVALID');
    return join(root, id + '.zip');
  }
  async beginUpload(raw: { name: string; bytes: number; digest: string; contentType: 'application/zip' }) {
    const input = z
        .object({
          name: z.string().min(1).max(200),
          bytes: z
            .number()
            .int()
            .positive()
            .max(256 * 1024 ** 2),
          digest: z.string().regex(/^[a-f0-9]{64}$/),
          contentType: z.literal('application/zip'),
        })
        .strict()
        .parse(raw),
      who = await ilIdentity();
    const workspace = await this.d.specs.createWorkspace({ name: input.name, importing: true }),
      scope = { workspaceId: workspace.id };
    const capacity = await this.d.specs.reserveCapacity(scope, {
      objects: 2,
      revisions: 2,
      bytes: input.bytes + 1024 ** 3,
      metadataBytes: 128 * 1024 ** 2,
      controlBytes: 65536,
    });
    const id = randomUUID(),
      file = await open(await this.uploadFile(id), 'wx', 0o600);
    await file.close();
    const row = integrationUploadSchema.parse({
      id,
      workspaceId: workspace.id,
      owner: who.actor,
      digest: input.digest,
      bytes: input.bytes,
      offset: 0,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      state: 'uploading',
      importId: null,
      capacityToken: capacity.token,
      error: null,
    });
    await this.transferRows.change((rows) => rows.push(row));
    return row;
  }
  async uploads() {
    const who = await ilIdentity();
    return (await this.transferRows.all()).filter((r) => r.owner === who.actor);
  }
  async appendUpload(id: string, offset: number, data: string) {
    z.number().int().nonnegative().parse(offset);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))
      ilFail('UPLOAD_ENCODING');
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > 512 * 1024 || bytes.toString('base64') !== data)
      ilFail('UPLOAD_CHUNK_SIZE');
    const who = await ilIdentity();
    return this.transferRows.change(async (rows) => {
      const row = rows.find((r) => r.id === id && r.owner === who.actor);
      if (!row || row.state !== 'uploading' || Date.parse(row.expiresAt) < Date.now())
        ilFail('UPLOAD_NOT_ACTIVE');
      if (offset > row.offset || offset + bytes.length > row.bytes) ilFail('UPLOAD_OFFSET');
      await this.d.specs.assertWorkspace({ workspaceId: row.workspaceId, allowImporting: true });
      const path = await this.uploadFile(id),
        info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) ilFail('UPLOAD_PATH_INVALID');
      const file = await open(path, 'r+');
      try {
        const current = await file.stat();
        if (current.size > row.offset + bytes.length || current.size < row.offset)
          ilFail('UPLOAD_SIZE_CHANGED');
        if (offset < row.offset || current.size === offset + bytes.length) {
          const previous = Buffer.alloc(bytes.length);
          await file.read(previous, 0, previous.length, offset);
          if (!previous.equals(bytes)) ilFail('UPLOAD_RETRY_MISMATCH');
        } else {
          if (offset !== row.offset || current.size !== offset) ilFail('UPLOAD_OFFSET');
          await file.write(bytes, 0, bytes.length, offset);
          await file.sync();
        }
        row.offset = Math.max(row.offset, offset + bytes.length);
        return row;
      } finally {
        await file.close();
      }
    });
  }
  async completeUpload(id: string) {
    const work = this.tail.then(() => this.finishUpload(id));
    this.tail = work.catch(() => {});
    return work;
  }
  private async finishUpload(id: string) {
    const row = (await this.uploads()).find((r) => r.id === id);
    if (!row) ilFail('UPLOAD_NOT_FOUND');
    if (row.importId) return (await this.imports()).find((r) => r.id === row.importId)!;
    if (row.state !== 'uploading' || row.offset !== row.bytes) ilFail('UPLOAD_INCOMPLETE');
    try {
      const path = await this.uploadFile(id),
        info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== row.bytes)
        ilFail('UPLOAD_SIZE_CHANGED');
      const bytes = await readFile(path);
      if (createHash('sha256').update(bytes).digest('hex') !== row.digest) ilFail('UPLOAD_DIGEST');
      const bundle = verifyIntegrationBundle(readIntegrationZip(bytes));
      if (ilBytes(bundle) > 128 * 1024 ** 2) ilFail('IMPORT_METADATA_BUDGET');
      const workspace = (
        await this.d.specs.assertWorkspace({ workspaceId: row.workspaceId, allowImporting: true })
      ).workspace;
      let imported = (await this.imports()).find(
        (v) => v.workspace?.id === row.workspaceId && v.digest === bundle.digest,
      );
      if (!imported) {
        imported = integrationImportSchema.parse({
          id: randomUUID(),
          owner: row.owner,
          digest: bundle.digest,
          createdAt: new Date().toISOString(),
          state: 'quarantined',
          workspace,
          bundle,
          mapping: {},
          error: null,
        });
        await this.rows.change((rows) => rows.push(imported!));
      }
      await this.transferRows.change((rows) => {
        const r = rows.find((r) => r.id === id)!;
        r.importId = imported!.id;
        r.state = 'quarantined';
      });
      const retained = ilBytes(bundle) + 8192;
      await this.d.specs.commitCapacity({ workspaceId: row.workspaceId }, row.capacityToken, {
        objects: 2,
        revisions: 2,
        bytes: row.bytes + retained * 2,
        metadataBytes: retained,
        controlBytes: 4096,
      });
      return imported;
    } catch (error) {
      await this.transferRows.change((rows) => {
        const r = rows.find((r) => r.id === id)!;
        r.state = 'rejected';
        r.error = error instanceof Error ? error.message.slice(0, 200) : 'UPLOAD_REJECTED';
      });
      throw error;
    }
  }
  async discardUpload(id: string) {
    const row = (await this.uploads()).find((r) => r.id === id);
    if (!row) ilFail('UPLOAD_NOT_FOUND');
    if (row.importId) ilFail('UPLOAD_IMPORT_PROTECTED');
    if (row.state === 'discarded') return row;
    const path = await this.uploadFile(id);
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) ilFail('UPLOAD_PATH_INVALID');
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await this.d.specs.releaseCapacity({ workspaceId: row.workspaceId }, row.capacityToken);
    return this.transferRows.change((rows) => {
      const r = rows.find((r) => r.id === id)!;
      r.state = 'discarded';
      return r;
    });
  }
  async exportBundle(
    scope: IntegrationScope,
    input: {
      scenario: IntegrationRef;
      mock: IntegrationRef | null;
      assertions: IntegrationRef;
      reports: string[];
    },
  ) {
    await this.d.specs.assertWorkspace(scope);
    const scenario = (await ilSealed(this.d.scenarios, scope, input.scenario)).content,
      assertion = (await ilSealed(this.d.assertions, scope, input.assertions)).content;
    if (key(assertion.scenario) !== key(input.scenario)) ilFail('BUNDLE_CLOSURE_MISMATCH');
    const entries: IntegrationBundle['entries'] = [];
    const add = (
      kind: IntegrationBundle['entries'][number]['kind'],
      ref: IntegrationRef,
      content: unknown,
    ) => {
      const k = key(ref);
      if (entries.some((e) => e.key === k)) return;
      entries.push({
        kind,
        key: k,
        path: kind + '/' + k + '.json',
        bytes: ilBytes(content),
        digest: ilHash(content),
        content: content as IntegrationJson,
      });
    };
    add('spec', scenario.contract, (await ilSealed(this.d.specs, scope, scenario.contract)).content);
    const env = (await ilSealed(this.d.environments, scope, scenario.environment)).content;
    const { application: _application, ...portableEnvironment } = env;
    add('environment', scenario.environment, {
      ...portableEnvironment,
      target: { kind: 'unbound', slot: 'test-target' },
      credentials: env.credentials.map((c) => ({ slot: c.slot, header: c.header })),
    });
    for (const ref of scenario.fixtures)
      add('fixture', ref, (await ilSealed(this.d.fixtures, scope, ref)).content);
    if (input.mock) {
      const mock = (await ilSealed(this.d.mocks, scope, input.mock)).content;
      if (
        key(mock.contract) !== key(scenario.contract) ||
        ilHash(mock.fixtures) !== ilHash(scenario.fixtures)
      )
        ilFail('BUNDLE_CLOSURE_MISMATCH');
      add('mock', input.mock, mock);
    }
    add('scenario', input.scenario, scenario);
    add('assertion', input.assertions, assertion);
    for (const id of input.reports) {
      const report = await this.d.reports.get(scope, id);
      if (
        key(report.run.plan.scenario) !== key(input.scenario) ||
        key(report.run.plan.assertions) !== key(input.assertions) ||
        ilHash(report.run.plan.mock) !== ilHash(input.mock)
      )
        ilFail('REPORT_CLOSURE_MISMATCH');
      add(
        'report',
        { id: report.id, revision: report.digest },
        {
          origin: 'imported',
          createdAt: report.createdAt,
          verdict: report.verdict,
          evidenceCoverage: report.evidenceCoverage,
          cannotRecompute: report.cannotRecompute,
          runIdentityDigest: ilHash({ id: report.runId, createdAt: report.run.createdAt }),
          requests: report.run.requests,
          evaluation: report.run.evaluation ? { results: report.run.evaluation.results } : null,
          load: report.run.load,
        },
      );
    }
    const base = {
      format: 'sakura-integration-bundle/1' as const,
      tool: 'integration-http-v1' as const,
      createdAt: new Date().toISOString(),
      root: {
        scenario: key(input.scenario),
        mock: input.mock ? key(input.mock) : null,
        assertions: key(input.assertions),
      },
      entries,
    };
    return verifyIntegrationBundle({ ...base, digest: ilHash(base) });
  }
  async quarantine(input: { bundle: IntegrationBundle }) {
    const who = await ilIdentity();
    if (Object.keys(input).some((k) => k !== 'bundle')) ilFail('UNKNOWN_FIELD');
    const bundle = verifyIntegrationBundle(input.bundle);
    const workspace = await this.d.specs.createWorkspace({
      name: '隔离导入 ' + bundle.digest.slice(0, 8),
      importing: true,
    });
    const scope = { workspaceId: workspace.id };
    const bytes = ilBytes(bundle);
    const cap = await this.d.specs.reserveCapacity(scope, {
      objects: 1,
      revisions: 1,
      bytes: bytes * 3,
      metadataBytes: bytes,
      controlBytes: 65536,
    });
    const row = integrationImportSchema.parse({
      id: randomUUID(),
      owner: who.actor,
      digest: bundle.digest,
      createdAt: new Date().toISOString(),
      state: 'quarantined',
      workspace,
      bundle,
      mapping: {},
      error: null,
    });
    await this.rows.change((rows) => rows.push(row));
    await this.d.specs.commitCapacity(scope, cap.token);
    return row;
  }
  async imports() {
    const who = await ilIdentity();
    return (await this.rows.all()).filter((r) => r.owner === who.actor);
  }
  async accept(id: string, digest: string) {
    const work = this.tail.then(async () => {
      let row = (await this.imports()).find((r) => r.id === id);
      if (!row || row.digest !== digest) ilFail('IMPORT_DIGEST_MISMATCH');
      if (row.state === 'accepted') return row;
      verifyIntegrationBundle(row.bundle);
      const scope = { workspaceId: row.workspace!.id };
      await this.rows.change((rows) => {
        const r = rows.find((r) => r.id === id)!;
        r.state = 'accepting';
        r.error = null;
      });
      const remap = (ref: IntegrationRef) => {
        const v = row!.mapping[key(ref)];
        if (!v) ilFail('BUNDLE_CLOSURE_MISSING');
        return v;
      };
      try {
        for (const kind of ['spec', 'environment', 'fixture', 'mock', 'scenario', 'assertion'] as const)
          for (const entry of row.bundle.entries.filter((e) => e.kind === kind)) {
            if (row.mapping[entry.key]) continue;
            let content: unknown = entry.content;
            let port: Ports.IntegrationDefinitionsV1<any>;
            switch (kind) {
              case 'spec':
                port = this.d.specs;
                break;
              case 'environment':
                port = this.d.environments;
                break;
              case 'fixture':
                port = this.d.fixtures;
                break;
              case 'mock': {
                port = this.d.mocks;
                const v = mockSchema.parse(content);
                content = { ...v, contract: remap(v.contract), fixtures: v.fixtures.map(remap) };
                break;
              }
              case 'scenario': {
                port = this.d.scenarios;
                const v = scenarioSchema.parse(content);
                content = {
                  ...v,
                  contract: remap(v.contract),
                  environment: remap(v.environment),
                  fixtures: v.fixtures.map(remap),
                };
                break;
              }
              case 'assertion': {
                port = this.d.assertions;
                const v = assertionSchema.parse(content);
                content = { ...v, scenario: remap(v.scenario) };
                break;
              }
            }
            // 找到中断前已发布的同内容修订，避免恢复重复写入。 Recover a previously published identical revision.
            let saved = (await port.list(scope)).find((r) => ilHash(r.content) === ilHash(content));
            if (!saved) saved = await port.save(scope, { content });
            const sealed = await port.seal(scope, { id: saved.id, revision: saved.revision });
            row.mapping[entry.key] = { id: sealed.id, revision: sealed.revision };
            await this.rows.change((rows) => {
              rows.find((r) => r.id === id)!.mapping = structuredClone(row!.mapping);
            });
          }
        const current = (await this.d.specs.assertWorkspace({ ...scope, allowImporting: true })).workspace;
        const workspace =
          current.state === 'active' ? current : await this.d.specs.publishWorkspace(scope, current.revision);
        await this.rows.change((rows) => {
          const r = rows.find((r) => r.id === id)!;
          r.state = 'accepted';
          r.workspace = workspace;
        });
      } catch (error) {
        await this.rows.change((rows) => {
          const r = rows.find((r) => r.id === id)!;
          r.state = 'failed';
          r.error =
            error && typeof error === 'object' && 'code' in error
              ? String(error.code)
              : 'IMPORT_ACCEPT_FAILED';
        });
        throw error;
      }
      return (await this.imports()).find((r) => r.id === id)!;
    });
    this.tail = work.catch(() => {});
    return work;
  }
  async close() {
    await this.tail;
    await this.rows.close();
    await this.transferRows.close();
  }
}
