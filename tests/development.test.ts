/**
 * 模块职责：回归验证模块，围绕 `development` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `development`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: encrypted backups round-trip bytes and reject a wrong password, altered header, payload and truncation; cancelled encryption and decryption never overwrite an existing destination.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Bundles as BundlesType } from '../server/bundles';
import type { Machines as MachinesType } from '../server/machines';
import type { Workspaces as WorkspacesType } from '../server/workspaces';
import type { Engine } from '../server/runtime';
import type { ProjectServiceRecord } from '../server/project-service-scope.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-development-test-'));
process.env.SAKURA_DATA_DIR = root;
const { encryptFile, decryptFile, importEncrypted } = await import('../server/encrypted-backups.ts');
const { Secrets, privateLog, dpapi } = await import('../server/secrets.ts');
const { networkSchema, networkEnvironment, rewriteMirrors, NetworkProfiles } =
  await import('../server/network-profiles.ts');
const { presetSchema, presetScript, CommandPresets } = await import('../server/command-presets.ts');
const { gitActionSchema, parseStatus, repositoryPath } = await import('../server/git-workbench.ts');
const { containerActionSchema, Containers } = await import('../server/containers.ts');
const { verifyDevcontainerTemplateMetadata } = await import('../server/devcontainer-templates.ts');
const { Machines } = await import('../server/machines.ts');
const { DataMigration } = await import('../server/data-migration.ts');
const { DataDirectoryOwner } = await import('../server/data-directory-owner.ts');
const { dataDirectory } = await import('../server/data-directory.ts');
const { ServiceHealth } = await import('../server/service-health.ts');
const { runServices } = await import('../server/project-services.ts');
const { projectSchema } = await import('../server/workspaces.ts');
const { scopeIdentityFixture } = await import('./project-scope-identity-fixture.ts');
const { vmDir } = await import('../server/model.ts');
const { Jobs } = await import('../server/jobs.ts');
const { Backups } = await import('../server/backups.ts');
const { Ide, sshPath } = await import('../server/ide.ts');
const { restoreDrafts, saveDraftResult, anyDirty } = await import('../src/editor-drafts.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(root, /sakura-development-test-/);
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: encrypted backups round-trip bytes and reject a wrong password, altered header, payload and truncation
 * 状态影响 / State effects: `value[position]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `join`, `Buffer.concat`, `Buffer.from`, `Buffer.alloc`.
 * 检查边界 / Checked boundaries: `assert.ok(!(await readFile(encrypted)).includes(Buffer.from('private')))`; `assert.deepEqual(await readFile(restored), bytes)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('encrypted backups round-trip bytes and reject a wrong password, altered header, payload and truncation', async () => {
  const source = join(root, 'plain'),
    encrypted = join(root, 'encrypted'),
    restored = join(root, 'restored');
  const bytes = Buffer.concat([Buffer.from('樱花\0private\n'), Buffer.alloc(256 * 1024, 47)]);
  await writeFile(source, bytes);
  await encryptFile(source, encrypted, 'long-password-樱花');
  assert.ok(!(await readFile(encrypted)).includes(Buffer.from('private')));
  await decryptFile(encrypted, restored, 'long-password-樱花');
  assert.deepEqual(await readFile(restored), bytes);
  const damaged = join(root, 'damaged'),
    destination = join(root, 'partial');
  await assert.rejects(decryptFile(encrypted, destination, 'incorrect-password'), /密码错误/);
  await assert.rejects(stat(destination), { code: 'ENOENT' });
  for (const position of [12, 32, 65]) {
    const value = await readFile(encrypted);
    value[position] ^= 1;
    await writeFile(damaged, value);
    await assert.rejects(decryptFile(damaged, destination, 'long-password-樱花'), /密码错误/);
    await assert.rejects(stat(destination), { code: 'ENOENT' });
  }
  await writeFile(damaged, (await readFile(encrypted)).subarray(0, 35));
  await assert.rejects(decryptFile(damaged, destination, 'long-password-樱花'), /大小无效/);
  await assert.rejects(decryptFile(encrypted, restored, 'long-password-樱花'), { code: 'EEXIST' });
  assert.deepEqual(await readFile(restored), bytes);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancelled encryption and decryption never overwrite an existing destination
 * 协作入口 / Collaborators: `join`, `writeFile`, `encryptFile`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(decryptFile(encrypted, destination, 'cancel-password', AbortSignal.abort()))`; `assert.equal(await readFile(destination, 'utf8'), 'keep me')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cancelled encryption and decryption never overwrite an existing destination', async () => {
  const source = join(root, 'cancel-source'),
    encrypted = join(root, 'cancel-encrypted'),
    destination = join(root, 'cancel-plain');
  await writeFile(source, 'important content');
  await encryptFile(source, encrypted, 'cancel-password');
  await writeFile(destination, 'keep me');
  await assert.rejects(decryptFile(encrypted, destination, 'cancel-password', AbortSignal.abort()));
  assert.equal(await readFile(destination, 'utf8'), 'keep me');
  const cancelled = join(root, 'cancelled-new');
  await assert.rejects(decryptFile(encrypted, cancelled, 'cancel-password', AbortSignal.abort()));
  await assert.rejects(stat(cancelled), { code: 'ENOENT' });
  await assert.rejects(encryptFile(source, encrypted, 'cancel-password'), { code: 'EEXIST' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: encrypted backup jobs never retry as plaintext and wrong passwords do not import any data
 * 状态影响 / State effects: `machines.get`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `Buffer.from`, `JSON.stringify`, `createHash('sha256').update(data).digest`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done', job.error)`; `assert.equal(job.action, undefined)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('encrypted backup jobs never retry as plaintext and wrong passwords do not import any data', async () => {
  const id = randomUUID(),
    machines = new Machines({} as Engine, fakeVmNetwork);
  machines.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id, name: 'encrypted-test' }) as ReturnType<MachinesType['get']>`）。
   * Result: Return the branch-computed value (`({ id, name: 'encrypted-test' }) as ReturnType<MachinesType['get']>`).
   * 验证场景 / Scenario: encrypted backup jobs never retry as plaintext and wrong passwords do not import any data
   */
  () => ({ id, name: 'encrypted-test' }) as ReturnType<MachinesType['get']>;
  const data = Buffer.from('fake disk content'),
    manifest = Buffer.from(JSON.stringify({ sha256: createHash('sha256').update(data).digest('hex') })),
    length = Buffer.alloc(4);
  length.writeUInt32BE(manifest.length);
  const bundle = Buffer.concat([Buffer.from('SAKURA01'), length, manifest, data]);
  let imported = false;
  const bundles = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; _signal: AbortSignal; work: any。
     * 结果：返回分支计算值（`work(data.length, (output: NodeJS.WritableStream) => pipeline(Readable.from([bun…`），以 Promise 交付。
     * Result: Return the branch-computed value (`work(data.length, (output: NodeJS.WritableStream) => pipeline(Readable.from([bun…`) through a Promise.
     * 验证场景 / Scenario: encrypted backup jobs never retry as plaintext and wrong passwords do not import any data
     * 协作入口 / Collaborators: `work`.
     */
    withExportBudget: async (_id: string, _signal: AbortSignal, work: any) =>
      work(data.length, (output: NodeJS.WritableStream) => pipeline(Readable.from([bundle]), output)),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; output: NodeJS.WritableStream。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: encrypted backup jobs never retry as plaintext and wrong passwords do not import any data
     * 协作入口 / Collaborators: `pipeline`, `Readable.from`.
     */
    export: async (_id: string, output: NodeJS.WritableStream) => {
      await pipeline(Readable.from([bundle]), output);
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `name`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `name`; the actual branch determines its shape.
     * 验证场景 / Scenario: encrypted backup jobs never retry as plaintext and wrong passwords do not import any data
     * 状态影响 / State effects: `imported`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    import: async () => {
      imported = true;
      return { name: 'restored' };
    },
  } as unknown as BundlesType;
  const backups = new Backups(machines, bundles);
  try {
    await backups.policy(id, { directory: join(root, 'external-backups') });
    const job = await backups.run(id, 'backup-password-123');
    await backups.jobs.wait(id);
    assert.equal(job.status, 'done', job.error);
    assert.equal(job.action, undefined);
    const item = (await backups.view(id)).items[0];
    assert.equal(item.encrypted, true);
    const download = await backups.downloadable(id, item.id);
    assert.equal(download.type, 'file');
    assert.match(download.path, /external-backups/);
    await backups.operate(id, item.id, 'restore', 'restored', 'wrong-password');
    await backups.jobs.wait(id);
    assert.equal(backups.jobs.view(id)?.status, 'error');
    assert.equal(imported, false);
    await backups.operate(id, item.id, 'restore', 'restored', 'backup-password-123');
    await backups.jobs.wait(id);
    assert.equal(backups.jobs.view(id)?.status, 'done', backups.jobs.view(id)?.error);
    assert.equal(imported, true);
    assert.equal(
      (await readdir(root)).some((name) => name.startsWith('.decrypt-')),
      false,
    );
  } finally {
    await backups.close();
  }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: encrypted uploads are authenticated before import and temporary uploads are cleaned on failure
 * 协作入口 / Collaborators: `join`, `writeFile`, `encryptFile`, `readFile`.
 * 检查边界 / Checked boundaries: `assert.rejects( importEncrypted( bundles, 'restored', Readable.from([bytes]), 'wrong-password', new AbortController().signal, ), /…`; `assert.equal(imports, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('encrypted uploads are authenticated before import and temporary uploads are cleaned on failure', async () => {
  const source = join(root, 'upload-plain'),
    file = join(root, 'upload-encrypted');
  await writeFile(source, 'test bundle');
  await encryptFile(source, file, 'upload-password');
  const bytes = await readFile(file);
  let imports = 0;
  const bundles = {
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _name: string; stream: Readable。
     * 结果：返回受控对象，公开字段包括 `id`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `id`; the actual branch determines its shape.
     * 验证场景 / Scenario: encrypted uploads are authenticated before import and temporary uploads are cleaned on failure
     * 协作入口 / Collaborators: `chunks.push`, `Buffer.from`, `assert.equal`, `Buffer.concat(chunks).toString`.
     * 检查边界 / Checked boundaries: `assert.equal(Buffer.concat(chunks).toString(), 'test bundle')`.
     */
    importExternal: async (_name: string, stream: Readable) => {
      imports++;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      assert.equal(Buffer.concat(chunks).toString(), 'test bundle');
      return { id: 'restored' };
    },
  } as unknown as BundlesType;
  await assert.rejects(
    importEncrypted(
      bundles,
      'restored',
      Readable.from([bytes]),
      'wrong-password',
      new AbortController().signal,
    ),
    /密码错误/,
  );
  assert.equal(imports, 0);
  assert.equal(
    (
      await importEncrypted(
        bundles,
        'restored',
        Readable.from([bytes]),
        'upload-password',
        new AbortController().signal,
      )
    ).id,
    'restored',
  );
  assert.equal(imports, 1);
  assert.equal(
    (await readdir(root)).some((name) => /^\.(encrypted-import|decrypt)-/.test(name)),
    false,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private values are stored encrypted, listed as metadata and redacted across every chunk boundary
 * 状态影响 / State effects: `locks.get`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `join`, `secrets.save`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(await secrets.value(id, 'api-token'), 'hidden-value-123')`; `assert.deepEqual(Object.keys((await secrets.list(id))[0]).sort(), ['name', 'updatedAt'])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('private values are stored encrypted, listed as metadata and redacted across every chunk boundary', async () => {
  const id = randomUUID(),
    locks = new Machines({} as Engine, fakeVmNetwork);
  locks.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id }) as ReturnType<MachinesType['get']>`）。
   * Result: Return the branch-computed value (`({ id }) as ReturnType<MachinesType['get']>`).
   * 验证场景 / Scenario: private values are stored encrypted, listed as metadata and redacted across every chunk boundary
   */
  () => ({ id }) as ReturnType<MachinesType['get']>;
  const secrets = new Secrets(
    locks,
    async (kind, value) =>
      kind === 'protect'
        ? Buffer.from(value).reverse().toString('base64')
        : Buffer.from(value, 'base64').reverse().toString(),
    join(root, 'private'),
  );
  await secrets.save(id, { name: 'api-token', value: 'hidden-value-123' });
  assert.equal(await secrets.value(id, 'api-token'), 'hidden-value-123');
  assert.deepEqual(Object.keys((await secrets.list(id))[0]).sort(), ['name', 'updatedAt']);
  assert.ok(!(await readFile(join(root, 'private', id + '.json'), 'utf8')).includes('hidden-value-123'));
  assert.deepEqual(await secrets.resolve(id, { TOKEN: 'api-token' }), { TOKEN: 'hidden-value-123' });
  const text = 'before hidden-value-123 middle hidden-value-123 after';
  for (let i = 0; i <= text.length; i++) {
    let log = '';
    const stream = privateLog(
      (chunk) => {
        log += chunk;
      },
      ['hidden-value-123'],
    );
    stream.write(text.slice(0, i));
    stream.write(text.slice(i));
    stream.flush();
    assert.equal(log, 'before [私密配置已隐藏] middle [私密配置已隐藏] after');
  }
  await secrets.remove(id, 'api-token');
  await assert.rejects(secrets.value(id, 'api-token'), /缺少私密配置/);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Windows DPAPI can protect and recover a Unicode value without persisting plaintext
 * 协作入口 / Collaborators: `Buffer.from('test-only-樱花-credential').toString`, `Buffer.from`, `dpapi`, `assert.notEqual`.
 * 检查边界 / Checked boundaries: `assert.notEqual(encrypted, value)`; `assert.equal(await dpapi('unprotect', encrypted), value)`.
 */
test(
  'Windows DPAPI can protect and recover a Unicode value without persisting plaintext',
  { skip: process.platform !== 'win32' },
  async () => {
    const value = Buffer.from('test-only-樱花-credential').toString('base64');
    const encrypted = await dpapi('protect', value);
    assert.notEqual(encrypted, value);
    assert.equal(await dpapi('unprotect', encrypted), value);
  },
);
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: network previews reject credentials and preserve signing keys, comments and third-party repositories
 * 协作入口 / Collaborators: `assert.throws`, `networkSchema.parse`, `rewriteMirrors`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.throws(() => networkSchema.parse({ httpProxy: 'http://user:password@example.com' }))`; `assert.throws(() => networkSchema.parse({ pipIndex: 'https://example.com?token=x' }))`.
 */
test('network previews reject credentials and preserve signing keys, comments and third-party repositories', () => {
  assert.throws(() => networkSchema.parse({ httpProxy: 'http://user:password@example.com' }));
  assert.throws(() => networkSchema.parse({ pipIndex: 'https://example.com?token=x' }));
  const config = networkSchema.parse({
    npmRegistry: 'https://registry.example.com',
    httpProxy: 'http://127.0.0.1:7890',
    aptMirror: 'https://mirror.example.com/debian',
    aptSecurityMirror: 'https://mirror.example.com/debian-security',
    apkMirror: 'https://mirror.example.com/alpine',
  });
  const text =
    '# deb http://deb.debian.org/debian bookworm main\ndeb http://deb.debian.org/debian bookworm main\ndeb https://security.debian.org/debian-security bookworm-security main\nURIs: https://deb.debian.org/debian\nSigned-By: https://deb.debian.org/key.gpg\ndeb https://download.docker.com/linux/debian bookworm stable';
  const result = rewriteMirrors(text, 'debian', config);
  assert.match(result, /^# deb http:\/\/deb.debian.org/);
  assert.match(result, /deb https:\/\/mirror.example.com\/debian bookworm main/);
  assert.match(result, /URIs: https:\/\/mirror.example.com\/debian/);
  assert.match(result, /Signed-By: https:\/\/deb.debian.org\/key.gpg/);
  assert.match(result, /https:\/\/download.docker.com\/linux\/debian/);
  assert.equal(
    rewriteMirrors('https://dl-cdn.alpinelinux.org/alpine/v3.23/main', 'alpine', config),
    'https://mirror.example.com/alpine/v3.23/main',
  );
  assert.equal(networkEnvironment(config).NPM_CONFIG_REGISTRY, config.npmRegistry);
  assert.equal(networkEnvironment(config).http_proxy, config.httpProxy);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Git status handles renamed and untracked paths and rejects traversal or command injection
 * 协作入口 / Collaborators: `assert.deepEqual`, `parseStatus`, `assert.equal`, `repositoryPath.safeParse`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(parseStatus('R new name.ts\0old name.ts\0?? 新文件.txt\0 M src/index.ts\0'), [ { index: 'R', worktree: ' ', path: 'n…`; `assert.equal(repositoryPath.safeParse(path).success, false)`.
 */
test('Git status handles renamed and untracked paths and rejects traversal or command injection', () => {
  assert.deepEqual(parseStatus('R  new name.ts\0old name.ts\0?? 新文件.txt\0 M src/index.ts\0'), [
    { index: 'R', worktree: ' ', path: 'new name.ts', previous: 'old name.ts' },
    { index: '?', worktree: '?', path: '新文件.txt' },
    { index: ' ', worktree: 'M', path: 'src/index.ts' },
  ]);
  for (const path of ['../outside', 'a/../../b', '/root/file', 'a\0b'])
    assert.equal(repositoryPath.safeParse(path).success, false);
  for (const branch of ['--force', 'main;whoami', '$(whoami)'])
    assert.equal(gitActionSchema.safeParse({ action: 'switch', branch }).success, false);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: command parameters are quoted as data and stored presets preserve their identity
 * 状态影响 / State effects: `locks.get`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `presetSchema.parse`, `randomUUID`, `assert.match`, `presetScript`.
 * 检查边界 / Checked boundaries: `assert.match( presetScript(preset, { TARGET: "x'; touch /tmp/should-not-run; '" }), /export TARGET='x'\\'';/, )`; `assert.throws(() => presetScript(preset, { UNDECLARED: 'no' }), /未声明/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('command parameters are quoted as data and stored presets preserve their identity', async () => {
  const preset = {
    ...presetSchema.parse({
      name: 'Test',
      command: 'printf "%s" "$TARGET"',
      parameters: [{ name: 'TARGET', value: 'all' }],
    }),
    id: randomUUID(),
  };
  assert.match(
    presetScript(preset, { TARGET: "x'; touch /tmp/should-not-run; '" }),
    /export TARGET='x'\\'';/,
  );
  assert.throws(() => presetScript(preset, { UNDECLARED: 'no' }), /未声明/);
  assert.equal(
    presetSchema.safeParse({
      ...preset,
      parameters: [
        { name: 'X', value: '' },
        { name: 'X', value: 'two' },
      ],
    }).success,
    false,
  );
  const id = randomUUID(),
    locks = new Machines({} as Engine, fakeVmNetwork);
  locks.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id }) as ReturnType<MachinesType['get']>`）。
   * Result: Return the branch-computed value (`({ id }) as ReturnType<MachinesType['get']>`).
   * 验证场景 / Scenario: command parameters are quoted as data and stored presets preserve their identity
   */
  () => ({ id }) as ReturnType<MachinesType['get']>;
  const commands = new CommandPresets(locks, {} as WorkspacesType);
  try {
    await commands.save(id, preset);
    await commands.save(id, { ...preset, name: 'Updated' });
    const list = await commands.list(id);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Updated');
    await commands.remove(id, preset.id);
    assert.equal((await commands.list(id)).length, 0);
  } finally {
    await commands.close();
  }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: container actions reject unsafe identifiers, flags and parent Compose paths
 * 协作入口 / Collaborators: `assert.equal`, `containerActionSchema.safeParse`, `containers.view`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.equal(containerActionSchema.safeParse(input).success, false)`; `assert.equal((await containers.view('vm')).supported, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('container actions reject unsafe identifiers, flags and parent Compose paths', async () => {
  for (const input of [
    { action: 'stop', id: '--all' },
    { action: 'pull', image: 'nginx; touch /tmp/x' },
    { action: 'compose-up', file: '../compose.yaml' },
    { action: 'dockerfile-up', file: '../Dockerfile' },
    { action: 'dockerfile-up', file: '/etc/passwd' },
    { action: 'template-apply', templateId: 'unknown', version: '1.0.0' },
    { action: 'template-apply', templateId: 'debian', version: 'latest' },
  ])
    assert.equal(containerActionSchema.safeParse(input).success, false);
  const machines = { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ distro: 'alpine' })`）。
   * Result: Return the branch-computed value (`({ distro: 'alpine' })`).
   * 验证场景 / Scenario: container actions reject unsafe identifiers, flags and parent Compose paths
   */
  get: () => ({ distro: 'alpine' }) } as unknown as MachinesType;
  const containers = new Containers(machines, {/**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`()=>{}`）。
   * Result: Return the branch-computed value (`()=>{}`).
   * 验证场景 / Scenario: container actions reject unsafe identifiers, flags and parent Compose paths
   */
  beforeConfigChange:()=>()=>{}} as unknown as WorkspacesType);
  try {
    assert.equal((await containers.view('vm')).supported, false);
    await assert.rejects(containers.run('vm', { action: 'install' }), /Debian 和 Ubuntu/);
  } finally {
    await containers.close();
  }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private container workloads refuse an unverified runtime without using the shared daemon
 * 协作入口 / Collaborators: `containers.run`, `containers.jobs.wait`, `assert.equal`, `containers.jobs.view`.
 * 检查边界 / Checked boundaries: `assert.equal(containers.jobs.view('vm')?.status,'error')`; `assert.match(containers.jobs.view('vm')?.error || '',/私有 Docker/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('private container workloads refuse an unverified runtime without using the shared daemon', async () => {
  const executed:string[]=[];
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ distro: 'debian' })`）。
     * Result: Return the branch-computed value (`({ distro: 'debian' })`).
     * 验证场景 / Scenario: private container workloads refuse an unverified runtime without using the shared daemon
     */
    get: () => ({ distro: 'debian' }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: private container workloads refuse an unverified runtime without using the shared daemon
     */
    state: () => 'running',
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; run: ()=>Promise<unknown>。
     * 结果：返回分支计算值（`run()`），以 Promise 交付。
     * Result: Return the branch-computed value (`run()`) through a Promise.
     * 验证场景 / Scenario: private container workloads refuse an unverified runtime without using the shared daemon
     * 协作入口 / Collaborators: `run`.
     */
    locked: async (_id:string,run:/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    ()=>Promise<unknown>)=>run(),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: private container workloads refuse an unverified runtime without using the shared daemon
     * 协作入口 / Collaborators: `executed.push`, `JSON.stringify`.
     */
    exec: async (_id:string,command:string) => { executed.push(command); return { code: 0,
      stdout: JSON.stringify({present:false,running:false,valid:false,reason:null,runId:null,containers:0}), stderr: '' }; },
  } as unknown as MachinesType;
  const workspaces = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ directory: '/workspace', networkIsolation: 'private' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ directory: '/workspace', networkIsolation: 'private' })`) through a Promise.
     * 验证场景 / Scenario: private container workloads refuse an unverified runtime without using the shared daemon
     */
    config: async () => ({ directory: '/workspace', networkIsolation: 'private' }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({directory:'/workspace',networkIsolation:'private'})`），以 Promise 交付。
     * Result: Return the branch-computed value (`({directory:'/workspace',networkIsolation:'private'})`) through a Promise.
     * 验证场景 / Scenario: private container workloads refuse an unverified runtime without using the shared daemon
     */
    resolvedConfig: async () => ({directory:'/workspace',networkIsolation:'private'}),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`()=>{}`）。
     * Result: Return the branch-computed value (`()=>{}`).
     * 验证场景 / Scenario: private container workloads refuse an unverified runtime without using the shared daemon
     */
    beforeConfigChange:()=>()=>{},
    projects:{/**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'default'`）。
     * Result: Return the branch-computed value (`'default'`).
     * 验证场景 / Scenario: private container workloads refuse an unverified runtime without using the shared daemon
     */
    current:()=> 'default',/**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; _project: string; run: ()=>unknown。
     * 结果：返回分支计算值（`run()`）。
     * Result: Return the branch-computed value (`run()`).
     * 验证场景 / Scenario: private container workloads refuse an unverified runtime without using the shared daemon
     * 协作入口 / Collaborators: `run`.
     */
    inScope:(_id:string,_project:string,run:/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    ()=>unknown)=>run()},
  } as unknown as WorkspacesType;
  const containers = new Containers(machines, workspaces);
  try {
    for (const action of [
      { action: 'pull', image: 'debian:stable' },
      { action: 'dockerfile-up', file:'Dockerfile' },
      { action: 'compose-down', file: 'compose.yaml' },
    ]) {
      await containers.run('vm', action);
      await containers.jobs.wait('vm');
      assert.equal(containers.jobs.view('vm')?.status,'error');
      assert.match(containers.jobs.view('vm')?.error || '',/私有 Docker/);
    }
    assert.equal(executed.length,3);
    assert.ok(executed.every(command=>command.includes('systemctl') && !command.includes('docker --host unix:///var/run/docker.sock')));
  } finally {
    await containers.close();
  }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: official Dev Container template metadata binds the requested source, version and file paths
 * 协作入口 / Collaborators: `JSON.stringify`, `verifyDevcontainerTemplateMetadata`, `assert.equal`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(verified.reference, 'ghcr.io/devcontainers/templates/debian:4.0.2')`; `assert.deepEqual(verified.imageVariant?.choices, ['bookworm', 'trixie'])`.
 */
test('official Dev Container template metadata binds the requested source, version and file paths', () => {
  const metadata = {
    id: 'debian', version: '4.0.2', name: 'Debian', description: 'Debian environment',
    publisher: 'Dev Container Spec Maintainers',
    documentationURL: 'https://github.com/devcontainers/templates/tree/main/src/debian',
    options: { imageVariant: { type: 'string', default: 'bookworm', proposals: ['trixie', 'bookworm'] } },
    optionalPaths: ['.github/dependabot.yml'],
    files: ['.devcontainer/devcontainer.json', '.github/dependabot.yml'],
  };
  const output = `[log] metadata\n${JSON.stringify(metadata)}\n`;
  const verified = verifyDevcontainerTemplateMetadata(output, 'debian', '4.0.2');
  assert.equal(verified.reference, 'ghcr.io/devcontainers/templates/debian:4.0.2');
  assert.deepEqual(verified.imageVariant?.choices, ['bookworm', 'trixie']);
  assert.throws(() => verifyDevcontainerTemplateMetadata(output, 'python', '4.0.2'), /来源或版本/);
  assert.throws(() => verifyDevcontainerTemplateMetadata(output, 'debian', '4.0.1'), /来源或版本/);
  assert.throws(() => verifyDevcontainerTemplateMetadata(JSON.stringify({ ...metadata,
    publisher: 'Impostor' }), 'debian'), /来源或版本/);
  assert.throws(() => verifyDevcontainerTemplateMetadata(JSON.stringify({ ...metadata,
    files: ['../escape', '.devcontainer/devcontainer.json'] }), 'debian'), /元数据无效/);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: container view keeps project Dev Container files visible when the CLI is unavailable
 * 协作入口 / Collaborators: `containers.view`, `assert.equal`, `assert.deepEqual`, `containers.close`.
 * 检查边界 / Checked boundaries: `assert.equal(view.devcontainer?.cliInstalled, false)`; `assert.deepEqual(view.devcontainer?.files, ['Dockerfile', '.devcontainer/devcontainer.json'])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('container view keeps project Dev Container files visible when the CLI is unavailable', async () => {
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ distro: 'debian' })`）。
     * Result: Return the branch-computed value (`({ distro: 'debian' })`).
     * 验证场景 / Scenario: container view keeps project Dev Container files visible when the CLI is unavailable
     */
    get: () => ({ distro: 'debian' }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: container view keeps project Dev Container files visible when the CLI is unavailable
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: container view keeps project Dev Container files visible when the CLI is unavailable
     * 协作入口 / Collaborators: `command.includes`.
     */
    exec: async (_id: string, command: string) => {
      if (command.includes('SAKURA_DEVCONTAINER_VERSION'))
        return { code: 0, stdout: 'Dockerfile\n.devcontainer/devcontainer.json\nSAKURA_DEVCONTAINER_VERSION\nunavailable\n', stderr: '' };
      if (command.includes('SAKURA_IMAGES'))
        return { code: 0, stdout: 'SAKURA_IMAGES\nSAKURA_VOLUMES\nSAKURA_COMPOSE\nDocker Compose 2\nSAKURA_FILES\n', stderr: '' };
      return { code: 0, stdout: '27.0\n', stderr: '' };
    },
  } as unknown as MachinesType;
  const workspaces = {/**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`()=>{}`）。
   * Result: Return the branch-computed value (`()=>{}`).
   * 验证场景 / Scenario: container view keeps project Dev Container files visible when the CLI is unavailable
   */
  beforeConfigChange:()=>()=>{}, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ directory: '/workspace' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ directory: '/workspace' })`) through a Promise.
   * 验证场景 / Scenario: container view keeps project Dev Container files visible when the CLI is unavailable
   */
  config: async () => ({ directory: '/workspace' }) } as unknown as WorkspacesType;
  const containers = new Containers(machines, workspaces);
  try {
    const view = await containers.view('vm');
    assert.equal(view.devcontainer?.cliInstalled, false);
    assert.deepEqual(view.devcontainer?.files, ['Dockerfile', '.devcontainer/devcontainer.json']);
  } finally {
    await containers.close();
  }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: multiple drafts keep typing independent from an in-flight save and discard invalid restored entries
 * 协作入口 / Collaborators: `saveDraftResult`, `assert.equal`, `anyDirty`, `restoreDrafts`.
 * 检查边界 / Checked boundaries: `assert.equal(result[0].content, 'newer typing')`; `assert.equal(result[0].baseContent, 'submitted')`.
 */
test('multiple drafts keep typing independent from an in-flight save and discard invalid restored entries', () => {
  const submitted = { id: 'a', path: '/a', content: 'submitted', baseContent: 'old' },
    other = { id: 'b', path: '/b', content: 'b', baseContent: 'b' };
  const result = saveDraftResult([{ ...submitted, content: 'newer typing' }, other], submitted, 'v2');
  assert.equal(result[0].content, 'newer typing');
  assert.equal(result[0].baseContent, 'submitted');
  assert.equal(result[1], other);
  assert.equal(anyDirty(result), true);
  const renamed = { ...submitted, path: '/new-path', fresh: true };
  assert.equal(saveDraftResult([renamed], submitted, 'v2')[0], renamed);
  const restored = restoreDrafts([
    null,
    { path: 'relative', content: 'x' },
    submitted,
    submitted,
    { ...other, id: 'a' },
  ]);
  assert.equal(restored.length, 2);
  assert.notEqual(restored[0].id, restored[1].id);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: migration checks stale previews, preserves originals, and activates only a completed verified copy
 * 协作入口 / Collaborators: `join`, `mkdir`, `writeFile`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(migration.plan(source), /相同或相互包含/)`; `assert.rejects(migration.start(target, stale.token), /重新预览/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('migration checks stale previews, preserves originals, and activates only a completed verified copy', async () => {
  const source = join(root, 'migration-source'),
    target = join(root, 'migration-target');
  await mkdir(source);
  await writeFile(join(source, 'important.txt'), 'original');
  const machines = new Machines({ /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'{}'`），以 Promise 交付。
   * Result: Return the branch-computed value (`'{}'`) through a Promise.
   * 验证场景 / Scenario: migration checks stale previews, preserves originals, and activates only a completed verified copy
   */
  run: async () => '{}' } as unknown as Engine, fakeVmNetwork);
  const migration = new DataMigration(machines, () => [], source);
  try {
    await assert.rejects(migration.plan(source), /相同或相互包含/);
    const stale = await migration.plan(target);
    await writeFile(join(source, 'new.txt'), 'new');
    await assert.rejects(migration.start(target, stale.token), /重新预览/);
    assert.equal(machines.maintenance, false);
    const plan = await migration.plan(target);
    assert.equal(plan.count, 2);
    await migration.start(target, plan.token);
    await migration.jobs.wait('data');
    assert.equal(migration.jobs.view('data')?.status, 'done', migration.jobs.view('data')?.error);
    assert.equal(dataDirectory(source), target);
    assert.equal(await readFile(join(source, 'important.txt'), 'utf8'), 'original');
    assert.equal(await readFile(join(target, 'important.txt'), 'utf8'), 'original');
    await assert.rejects(
      machines.locked('new', async () => {}),
      /迁移维护/,
    );
    await migration.cancelActivation();
    assert.equal(dataDirectory(source), source);
    assert.equal(machines.maintenance, false);
  } finally {
    await migration.close();
  }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: migration refuses live guests, interrupted copies and unverified redirections
 * 协作入口 / Collaborators: `join`, `mkdir`, `writeFile`, `Buffer.alloc`.
 * 检查边界 / Checked boundaries: `assert.rejects(migration.start(target, plan.token), /停止全部实例/)`; `assert.equal(dataDirectory(source), source)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('migration refuses live guests, interrupted copies and unverified redirections', async () => {
  const source = join(root, 'interrupted-source'),
    target = join(root, 'interrupted-target');
  await mkdir(source);
  await writeFile(join(source, 'data'), Buffer.alloc(1024 * 1024));
  const machines = new Machines({} as Engine, fakeVmNetwork),
    migration = new DataMigration(machines, () => [], source);
  try {
    const plan = await migration.plan(target);
    machines.live.set('test', {} as never);
    await assert.rejects(migration.start(target, plan.token), /停止全部实例/);
    machines.live.clear();
    await migration.start(target, plan.token);
    migration.jobs.cancel('data');
    await migration.jobs.wait('data');
    assert.equal(dataDirectory(source), source);
    assert.equal(machines.maintenance, false);
    assert.equal(
      (await readdir(root)).some((name) => name.startsWith('.sakura-migrate-')),
      false,
    );
    await mkdir(target);
    await writeFile(
      join(source, '.sakura-redirect.json'),
      JSON.stringify({ version: 1, target, id: 'expected' }),
    );
    await writeFile(
      join(target, '.sakura-migration.json'),
      JSON.stringify({ id: 'different', source, completedAt: 'now' }),
    );
    assert.throws(() => dataDirectory(source), /尚未完成/);
  } finally {
    await migration.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: flushing unchanged job history does not invalidate a reviewed migration plan
 * 协作入口 / Collaborators: `join`, `mkdir`, `jobs.start`, `jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal((await stat(file)).mtimeMs, modified)`; `assert.equal(migration.jobs.view('data')?.status, 'done', migration.jobs.view('data')?.error)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('flushing unchanged job history does not invalidate a reviewed migration plan', async () => {
  const source = join(root, 'history-migration-source'),
    target = join(root, 'history-migration-target');
  await mkdir(source);
  const jobs = new Jobs('existing-task', join(source, 'jobs'));
  const machines = new Machines({} as Engine, fakeVmNetwork),
    migration = new DataMigration(machines, () => [jobs], source);
  try {
    jobs.start('example', async () => {});
    await jobs.wait('example');
    const plan = await migration.plan(target),
      file = join(source, 'jobs', 'existing-task.json'),
      modified = (await stat(file)).mtimeMs;
    await jobs.flush();
    assert.equal((await stat(file)).mtimeMs, modified);
    await migration.start(target, plan.token);
    await migration.jobs.wait('data');
    assert.equal(migration.jobs.view('data')?.status, 'done', migration.jobs.view('data')?.error);
    await migration.cancelActivation();
  } finally {
    await migration.close();
    await jobs.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH includes from a previous migrated directory are repaired without editing the user config
 * 协作入口 / Collaborators: `join`, `mkdir`, `writeFile`, `JSON.stringify`.
 * 检查边界 / Checked boundaries: `assert.equal( await readFile(join(previous, 'ssh', 'config'), 'utf8'), `Include ${sshPath(join(root, 'ssh', 'config'))}\n`, )`; `assert.rejects(stat(join(root, 'test-user-ssh')), { code: 'ENOENT' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('SSH includes from a previous migrated directory are repaired without editing the user config', async () => {
  const previous = join(root, 'old-data-root');
  await mkdir(join(previous, 'ssh'), { recursive: true });
  await writeFile(
    join(previous, '.sakura-redirect.json'),
    JSON.stringify({ version: 1, target: root, id: 'ssh-migration' }),
  );
  await writeFile(
    join(root, '.sakura-migration.json'),
    JSON.stringify({ source: previous, id: 'ssh-migration', completedAt: 'now' }),
  );
  const machines = new Machines({} as Engine, fakeVmNetwork),
    ide = new Ide(machines, {} as WorkspacesType, join(root, 'test-user-ssh'));
  try {
    await ide.update();
    assert.equal(
      await readFile(join(previous, 'ssh', 'config'), 'utf8'),
      `Include ${sshPath(join(root, 'ssh', 'config'))}\n`,
    );
    await assert.rejects(stat(join(root, 'test-user-ssh')), { code: 'ENOENT' });
  } finally {
    await ide.close();
    await rm(join(root, '.sakura-migration.json'));
  }
});
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: id: string; secret = ''。
 * 结果：返回受控对象，公开字段包括 `emitter, records, commands, register, counts, setStopFailure, setExited`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `emitter, records, commands, register, counts, setStopFailure, setExited`; the actual branch determines its shape.
 * 状态影响 / State effects: `emitter.live`, `emitter.state`, `emitter.get`, `emitter.locked`, `emitter.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`.
 */
function managedHealthFixture(id: string, secret = '') {
  const bootId = randomUUID(), records = new Map<string, ProjectServiceRecord>(), exited = new Set<string>();
  let sequence = 0, probes = 0, stops = 0, failStops = false;
  const emitter = new EventEmitter() as unknown as MachinesType;
  emitter.live = new Map([[id, {} as never]]);
  emitter.state = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'running'`）。
   * Result: Return the branch-computed value (`'running'`).
   */
  () => 'running';
  emitter.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id, distro: 'debian' }) as ReturnType<MachinesType['get']>`）。
   * Result: Return the branch-computed value (`({ id, distro: 'debian' }) as ReturnType<MachinesType['get']>`).
   */
  () => ({ id, distro: 'debian' }) as ReturnType<MachinesType['get']>;
  emitter.locked = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: _key; action。
   * 结果：返回分支计算值（`await action()`），以 Promise 交付。
   * Result: Return the branch-computed value (`await action()`) through a Promise.
   * 协作入口 / Collaborators: `action`.
   */
  async (_key, action) => await action();
  const commands: string[] = [];
  emitter.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; script。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 状态影响 / State effects: `record`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 失败 / Failure: `new Error('owned service cleanup refused ' + secret)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `commands.push`, `script.split('\n').find`, `script.split`, `script.includes`.
   * 检查边界 / Checked boundaries: `assert.ok(previous)`; `assert.ok(previous)`.
   * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
   * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
   */
  async (_id, script) => {
    commands.push(script);
    const prefix = '# SAKURA_PROJECT_SERVICE_REQUEST=';
    const encoded = script.split('\n').find(line => line.startsWith(prefix));
    if (!encoded) {
      const probe = script.includes('# SAKURA_GUEST_TASK_RUN') && script.includes('health-probe');
      if (probe) probes++;
      return { code: probe ? 1 : 0, stdout: '', stderr: '' };
    }
    const input = JSON.parse(Buffer.from(encoded.slice(prefix.length), 'base64').toString());
    if (input.op === 'probe-reboot') return { code: 0, stdout: JSON.stringify({ bootId, retired: false }), stderr: '' };
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: status: string; record: ProjectServiceRecord | null。
     * 结果：返回分支计算值（`({ code: 0, stdout: JSON.stringify({ status, bootId, record }), stderr: '', })`）。
     * Result: Return the branch-computed value (`({ code: 0, stdout: JSON.stringify({ status, bootId, record }), stderr: '', })`).
     * 协作入口 / Collaborators: `JSON.stringify`.
     */
    const reply = (status: string, record: ProjectServiceRecord | null) => ({
      code: 0, stdout: JSON.stringify({ status, bootId, record }), stderr: '',
    });
    const previous = records.get(input.name);
    if (input.op === 'status') return reply(previous?.phase === 'running' && exited.has(input.name) ? 'exited' : previous?.phase || 'absent', previous || null);
    let record: ProjectServiceRecord;
    if (input.op === 'prepare') {
      exited.delete(input.name);
      record = { ...input.record, phase: 'prepared', inode: String(1000 + ++sequence) };
    } else if (input.op === 'start') {
      assert.ok(previous);
      record = { ...previous, sessionId: '$' + sequence, paneId: '%' + sequence,
        panePid: 100 + sequence, paneStartTicks: String(2000 + sequence) };
    } else if (input.op === 'commit') {
      assert.ok(previous);
      record = { ...previous, phase: 'running' };
    } else {
      assert.equal(input.op, 'stop');
      stops++;
      if (failStops) throw new Error('owned service cleanup refused ' + secret);
      record = { ...(previous || input.record), phase: 'stopped' };
    }
    records.set(input.name, record);
    return reply(record.phase, record);
  };
  return { emitter, records, commands, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: project: ReturnType<typeof projectSchema.parse>。
   * 结果：返回分支计算值（`scopeIdentityFixture(emitter, project, () => bootId, runId => [...records.values…`）。
   * Result: Return the branch-computed value (`scopeIdentityFixture(emitter, project, () => bootId, runId => [...records.values…`).
   * 协作入口 / Collaborators: `scopeIdentityFixture`.
   */
  register: (project: ReturnType<typeof projectSchema.parse>) =>
      scopeIdentityFixture(emitter, project, () => bootId, runId => [...records.values()].find(record => record.runId === runId) || null,
        execution => { if (execution.command.includes('health-probe')) { ++probes; return 1; } return 0; }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ probes, stops })`）。
     * Result: Return the branch-computed value (`({ probes, stops })`).
     */
    counts: () => ({ probes, stops }), /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `failStops`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setStopFailure: (value: boolean) => { failStops = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: name: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `exited.add`.
     */
    setExited: (name: string) => { exited.add(name); } };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: health checks back off, enforce restart limits, preserve state after failed stops and honour manual stops
 * 协作入口 / Collaborators: `randomUUID`, `projectSchema.parse`, `managedHealthFixture`, `f.register`.
 * 检查边界 / Checked boundaries: `assert.equal(health.jobs.view(id)?.status, 'done', health.jobs.view(id)?.error)`; `assert.equal((await health.view(id)).services[0].restarts, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('health checks back off, enforce restart limits, preserve state after failed stops and honour manual stops', async () => {
  const id = randomUUID(),
    project = projectSchema.parse({
      services: [
        {
          name: 'api',
          command: 'sleep 60',
          health: {
            command: 'health-probe',
            failures: 1,
            interval: 5,
            maxRestarts: 1,
            restart: true,
            backoff: 5,
          },
        },
      ],
    });
  const f = managedHealthFixture(id), { emitter } = f;
  f.register(project);
  const projects = new Jobs('health-test-projects', root);
  const workspaces = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`() => {}`）。
     * Result: Return the branch-computed value (`() => {}`).
     * 验证场景 / Scenario: health checks back off, enforce restart limits, preserve state after failed stops and honour manual stops
     */
    beforeAction: () => () => {},
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     * 验证场景 / Scenario: health checks back off, enforce restart limits, preserve state after failed stops and honour manual stops
     */
    config: async () => project,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     * 验证场景 / Scenario: health checks back off, enforce restart limits, preserve state after failed stops and honour manual stops
     */
    resolvedConfig: async () => project,
    jobs: projects,
  } as unknown as WorkspacesType;
  const health = new ServiceHealth(emitter, workspaces);
  try {
    (await health.expect(id, 'start'))(true);
    await health.tick(10000);
    await health.jobs.wait(id);
    assert.equal(health.jobs.view(id)?.status, 'done', health.jobs.view(id)?.error);
    assert.equal((await health.view(id)).services[0].restarts, 1);
    await health.tick(12000);
    assert.equal((await health.view(id)).services[0].failures, 1);
    await health.tick(20000);
    assert.equal((await health.view(id)).services[0].status, 'exhausted');
    (await health.expect(id, 'stop'))(false);
    assert.equal((await health.view(id)).services[0].desired, true);
    (await health.expect(id, 'stop'))(true);
    await health.tick(30000);
    assert.equal((await health.view(id)).services[0].desired, false);
    (await health.expect(id, 'start'))(false);
    assert.equal((await health.view(id)).services[0].desired, false);
  } finally {
    await health.close();
    await projects.close();
  }
});
for (const changed of ['run', 'missing', 'exited'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `record.runId`, `record.scopeName`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `randomUUID`, `managedHealthFixture`, `projectSchema.parse`, `f.register`.
   * 检查边界 / Checked boundaries: `assert.equal(f.counts().probes, 0)`; `assert.equal(f.counts().stops, 0)`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test(`health checks verify service ${changed} ownership before executing a project probe`, async () => {
    const id = randomUUID(), f = managedHealthFixture(id);
    const project = projectSchema.parse({ services: [{ name: 'api', command: 'sleep 60', health: {
      command: 'health-probe', failures: 1, interval: 5, maxRestarts: 3, restart: true,
    } }] });
    f.register(project);
    const projects = new Jobs('health-service-identity-' + changed, root);
    const workspaces = { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`() => {}`）。
     * Result: Return the branch-computed value (`() => {}`).
     */
    beforeAction: () => () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     */
    config: async () => project, /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     */
    resolvedConfig: async () => project, jobs: projects } as unknown as WorkspacesType;
    const health = new ServiceHealth(f.emitter, workspaces);
    try {
      await runServices(f.emitter, id, project, 'start', () => {}, new AbortController().signal);
      const oldRun = f.records.get('api')!.runId;
      (await health.expect(id, 'start'))(true);
      if (changed === 'run') {
        const record = f.records.get('api')!;
        record.runId = randomUUID(); record.scopeName = 'sakura-service-' + record.runId;
      } else if (changed === 'missing') f.records.delete('api');
      else f.setExited('api');
      await health.tick(10000);
      await health.jobs.wait(id);
      assert.equal(f.counts().probes, 0);
      const state = (await health.view(id)).services[0];
      if (changed !== 'exited') {
        assert.equal(f.counts().stops, 0);
        assert.equal(state.restarts, 0);
        assert.match(state.error!, /自动检查与重启已暂停/);
        await health.tick(30000);
        assert.equal(f.counts().probes, 0);
      } else {
        assert.equal(f.counts().stops, 1);
        assert.equal(health.jobs.view(id)?.status, 'done', health.jobs.view(id)?.error);
        assert.notEqual(f.records.get('api')!.runId, oldRun);
        assert.equal(state.status, 'waiting');
      }
    } finally {
      await health.close();
      await projects.close();
    }
  });
}
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an unconfirmed service stop pauses the whole restart chain and retains ownership until manual recovery
 * 协作入口 / Collaborators: `randomUUID`, `projectSchema.parse`, `managedHealthFixture`, `f.register`.
 * 检查边界 / Checked boundaries: `assert.equal(health.jobs.view(id)?.status, 'error')`; `assert.equal(f.counts().stops, 3)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('an unconfirmed service stop pauses the whole restart chain and retains ownership until manual recovery', async () => {
  const id = randomUUID(), secret = 'service-health-private-token';
  const project = projectSchema.parse({ environment: { TOKEN: secret }, secrets: { TOKEN: 'health-token' },
    services: [
      { name: 'api', command: 'sleep 60', health: {
        command: 'health-probe', failures: 1, interval: 5, maxRestarts: 3, restart: true,
      } },
      { name: 'worker', command: 'sleep 60', dependsOn: ['api'], health: {
        command: 'health-probe', failures: 1, interval: 5, maxRestarts: 3, restart: true,
      } },
    ],
  });
  const f = managedHealthFixture(id, secret);
  f.register(project);
  const projects = new Jobs('health-service-cleanup-test', root);
  const workspaces = { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`() => {}`）。
   * Result: Return the branch-computed value (`() => {}`).
   * 验证场景 / Scenario: an unconfirmed service stop pauses the whole restart chain and retains ownership until manual recovery
   */
  beforeAction: () => () => {}, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`project`），以 Promise 交付。
   * Result: Return the branch-computed value (`project`) through a Promise.
   * 验证场景 / Scenario: an unconfirmed service stop pauses the whole restart chain and retains ownership until manual recovery
   */
  config: async () => project, /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`project`），以 Promise 交付。
   * Result: Return the branch-computed value (`project`) through a Promise.
   * 验证场景 / Scenario: an unconfirmed service stop pauses the whole restart chain and retains ownership until manual recovery
   */
  resolvedConfig: async () => project, jobs: projects } as unknown as WorkspacesType;
  const health = new ServiceHealth(f.emitter, workspaces);
  const signal = new AbortController().signal;
  try {
    await runServices(f.emitter, id, project, 'start', () => {}, signal);
    const runs = [...f.records.values()].map(record => record.runId);
    (await health.expect(id, 'start'))(true);
    f.setStopFailure(true);
    await health.tick(10000);
    await health.jobs.wait(id);
    assert.equal(health.jobs.view(id)?.status, 'error');
    assert.equal(f.counts().stops, 3);
    assert.equal(f.counts().probes, 1);
    for (const state of (await health.view(id)).services) {
      assert.equal(state.status, 'unhealthy');
      assert.equal(state.desired, true);
      assert.match(state.error!, /自动检查与重启已暂停/);
      assert.equal(state.error!.includes(secret), false);
    }
    assert.equal(health.jobs.view(id)?.error?.includes(secret), false);
    assert.deepEqual([...f.records.values()].map(record => record.runId), runs);
    await health.tick(30000);
    assert.equal(f.counts().probes, 1);
    const failed = await health.expect(id, 'stop');
    await assert.rejects(runServices(f.emitter, id, project, 'stop', () => {}, signal),
      error => (error as { code: string }).code === 'SERVICE_CLEANUP_FAILED');
    failed(false);
    await health.tick(50000);
    assert.equal(f.counts().probes, 1);
    assert.ok((await health.view(id)).services.every(state => state.desired));
    f.setStopFailure(false);
    const recovered = await health.expect(id, 'stop');
    await runServices(f.emitter, id, project, 'stop', () => {}, signal);
    recovered(true);
    assert.ok((await health.view(id)).services.every(state => !state.desired));
    const restarted = await health.expect(id, 'start');
    await runServices(f.emitter, id, project, 'start', () => {}, signal);
    restarted(true);
    await health.tick(70000);
    await health.jobs.wait(id);
    assert.equal(f.counts().probes, 2);
    assert.equal(health.jobs.view(id)?.status, 'done', health.jobs.view(id)?.error);
  } finally {
    await health.close();
    await projects.close();
  }
});
for (const invalid of ['missing-host-ticket', 'closed-guest-ticket', 'refused-before-probe-ticket'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `identity.tickets.get(record.runId)!.phase`, `journal.runs`, `f.emitter.execInput`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `randomUUID`, `projectSchema.parse`, `managedHealthFixture`, `f.register`.
   * 检查边界 / Checked boundaries: `assert.equal(state.status, 'unhealthy')`; `assert.equal(state.failures, 0)`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test(`health blocks a ${invalid} before executing a project probe and retains the pause`, async () => {
    const id = randomUUID(), secret = 'health-identity-private-value';
    const project = projectSchema.parse({ environment: { TOKEN: secret }, secrets: { TOKEN: 'secret-ref' },
      services: [{ name: 'api', command: 'sleep 60', health: {
        command: 'health-probe', failures: 1, interval: 5, maxRestarts: 1, restart: true,
      } }],
    });
    const f = managedHealthFixture(id), identity = f.register(project);
    await runServices(f.emitter, id, project, 'start', () => {}, new AbortController().signal);
    const record = f.records.get('api')!;
    if (invalid === 'closed-guest-ticket') identity.tickets.get(record.runId)!.phase = 'closed';
    else if (invalid === 'missing-host-ticket') {
      const file = join(vmDir(id), 'project-identities', 'default.json');
      const journal = JSON.parse(await readFile(file, 'utf8')); journal.runs = [];
      await writeFile(file, JSON.stringify(journal));
    }
    else f.emitter.execInput = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ code: 1, stderr: '', stdout: '{"ok":false,"code":"DIRECTORY_MIGRATION_IDENTIT…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 1, stderr: '', stdout: '{"ok":false,"code":"DIRECTORY_MIGRATION_IDENTIT…`) through a Promise.
     */
    async () => ({ code: 1, stderr: '',
      stdout: '{"ok":false,"code":"DIRECTORY_MIGRATION_IDENTITY","detail":null}' });
    const projects = new Jobs('health-invalid-identity', root);
    const health = new ServiceHealth(f.emitter, { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`() => {}`）。
     * Result: Return the branch-computed value (`() => {}`).
     */
    beforeAction: () => () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     */
    config: async () => project, /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     */
    resolvedConfig: async () => project,
      jobs: projects } as unknown as WorkspacesType);
    try {
      (await health.expect(id, 'start'))(true); await health.tick(10000);
      const state = (await health.view(id)).services[0];
      assert.equal(state.status, 'unhealthy'); assert.equal(state.failures, 0); assert.equal(state.restarts, 0);
      assert.match(state.error!, /自动检查与重启已暂停/); assert.ok(!state.error!.includes(secret));
      assert.equal(f.counts().probes, 0);
      if (invalid === 'refused-before-probe-ticket') {
        assert.match(state.error!, /未确认发行本次运行票据/);
        assert.equal(f.counts().stops, 0);
        assert.equal(f.records.get('api')?.runId, record.runId);
      }
      assert.equal(health.jobs.view(id), null);
      assert.ok(f.commands.every(command => !command.includes(secret)));
      const reads = identity.state.readonlyCalls;
      await health.tick(30000); assert.equal(f.counts().probes, 0); assert.equal(identity.state.readonlyCalls, reads);
    } finally { await health.close(); await projects.close(); }
  });
}

for (const failure of ['cleanup', 'scope'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `emitter.exec`, `emitter.execInput`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `randomUUID`, `projectSchema.parse`, `managedHealthFixture`, `f.register`.
   * 检查边界 / Checked boundaries: `assert.equal(state.status, 'unhealthy')`; `assert.equal(state.failures, 0)`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test(`health ${failure} failures pause automatic probes and restarts until a successful manual action`, async () => {
    const id = randomUUID(), secret = 'health-private-token';
    const project = projectSchema.parse({
      environment: { TOKEN: secret }, secrets: { TOKEN: 'health-token' },
      services: [{ name: 'api', command: 'sleep 60', health: {
        command: 'health-probe', failures: 1, interval: 5, maxRestarts: 1, restart: true,
      } }],
    });
    let workers = 0, controls = 0;
    const f = managedHealthFixture(id), { emitter } = f;
    f.register(project);
    await runServices(emitter, id, project, 'start', () => {}, new AbortController().signal);
    const managedExec = emitter.exec, managedInput = emitter.execInput;
    const cleanupCommands: string[] = [];
    emitter.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id; script。
     * 结果：返回分支计算值（`managedExec(_id, script) / failure === 'cleanup' ? { code: 1, stdout: '', stderr: `owned scope still popula…`），以 Promise 交付。
     * Result: Return the branch-computed value (`managedExec(_id, script) / failure === 'cleanup' ? { code: 1, stdout: '', stderr: `owned scope still popula…`) through a Promise.
     * 协作入口 / Collaborators: `script.includes`, `managedExec`, `cleanupCommands.push`.
     */
    async (_id, script) => {
      if (!script.includes('sakura_owned_anchor')) return managedExec(_id, script);
      controls++; cleanupCommands.push(script);
      return failure === 'cleanup' ? { code: 1, stdout: '', stderr: `owned scope still populated ${secret}` }
        : managedExec(_id, script);
    };
    emitter.execInput = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`failure === 'scope' ? { ...result, code: 126, stderr: `SAKURA_TASK_SCOPE_UNAVAIL…`），以 Promise 交付。
     * Result: Return the branch-computed value (`failure === 'scope' ? { ...result, code: 126, stderr: `SAKURA_TASK_SCOPE_UNAVAIL…`) through a Promise.
     * 协作入口 / Collaborators: `managedInput`.
     */
    async (...args) => {
      workers++;
      const result = await managedInput(...args);
      return failure === 'scope' ? { ...result, code: 126, stderr: `SAKURA_TASK_SCOPE_UNAVAILABLE: no cgroup.kill ${secret}` }
        : { ...result, code: 0 };
    };
    const projects = new Jobs('health-unconfirmed-test', root);
    const workspaces = {
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`() => {}`）。
       * Result: Return the branch-computed value (`() => {}`).
       */
      beforeAction: () => () => {}, /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`project`），以 Promise 交付。
       * Result: Return the branch-computed value (`project`) through a Promise.
       */
      config: async () => project, /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`project`），以 Promise 交付。
       * Result: Return the branch-computed value (`project`) through a Promise.
       */
      resolvedConfig: async () => project, jobs: projects,
    } as unknown as WorkspacesType;
    const health = new ServiceHealth(emitter, workspaces);
    try {
      (await health.expect(id, 'start'))(true);
      await health.tick(10000);
      const state = (await health.view(id)).services[0];
      assert.equal(state.status, 'unhealthy');
      assert.equal(state.failures, 0);
      assert.equal(state.restarts, 0);
      assert.match(state.error!, /自动检查与重启已暂停/);
      assert.equal(state.error!.includes(secret), false);
      assert.match(state.error!, failure === 'cleanup' ? /owned scope still populated/ : /no cgroup.kill/);
      assert.equal(health.jobs.view(id), null);
      assert.equal(workers, 1);
      if (failure === 'cleanup') assert.equal(controls, 3);
      await health.tick(30000);
      assert.equal(workers, 1);
      (await health.expect(id, 'stop'))(false);
      await health.tick(50000);
      assert.equal(workers, 1);
      assert.equal((await health.view(id)).services[0].desired, true);
      (await health.expect(id, 'stop'))(true);
      await health.tick(70000);
      assert.equal(workers, 1);
      assert.equal((await health.view(id)).services[0].desired, false);
      // The operator retried the retained original task cleanup successfully.
      // A service intent toggle alone cannot claim that task domain disappeared.
      if (failure === 'cleanup') await managedExec(id, cleanupCommands[0]);
      (await health.expect(id, 'start'))(true);
      await health.tick(90000);
      assert.equal(workers, 2);
    } finally {
      await health.close();
      await projects.close();
    }
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: interrupted network changes can be restored but externally changed files are protected
 * 状态影响 / State effects: `locks.get`, `locks.sftp`, `locks.readGuestFile`, `locks.writeGuestFile`, `locks.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `network.preview`, `assert.rejects`, `network.apply`.
 * 检查边界 / Checked boundaries: `assert.rejects( network.apply(id, { httpProxy: 'http://localhost:7891' }, preview.token), /重新预览/, )`; `assert.ok((await network.environment(id)).HTTP_PROXY)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('interrupted network changes can be restored but externally changed files are protected', async () => {
  const id = randomUUID(),
    locks = new Machines({} as Engine, fakeVmNetwork),
    files = new Map([['/etc/profile.d/sakura-network.sh', 'before']]);
  locks.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id, distro: 'alpine' }) as ReturnType<MachinesType['get']>`）。
   * Result: Return the branch-computed value (`({ id, distro: 'alpine' }) as ReturnType<MachinesType['get']>`).
   * 验证场景 / Scenario: interrupted network changes can be restored but externally changed files are protected
   */
  () => ({ id, distro: 'alpine' }) as ReturnType<MachinesType['get']>;
  locks.sftp = (/**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: _id: string; work: (ftp: unknown) => Promise<unknown>。
   * 结果：返回分支计算值（`work({ lstat: (path: string, done: Function) => files.has(path) ? done(null, { i…`），以 Promise 交付。
   * Result: Return the branch-computed value (`work({ lstat: (path: string, done: Function) => files.has(path) ? done(null, { i…`) through a Promise.
   * 验证场景 / Scenario: interrupted network changes can be restored but externally changed files are protected
   * 协作入口 / Collaborators: `work`.
   */
  async (_id: string, work: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: ftp: unknown。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (ftp: unknown) => Promise<unknown>) =>
    work({
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: path: string; done: Function。
       * 结果：返回分支计算值（`files.has(path) ? done(null, { isFile: () => true }) : done({ code: 2 })`）。
       * Result: Return the branch-computed value (`files.has(path) ? done(null, { isFile: () => true }) : done({ code: 2 })`).
       * 验证场景 / Scenario: interrupted network changes can be restored but externally changed files are protected
       * 协作入口 / Collaborators: `files.has`, `done`.
       */
      lstat: (path: string, done: Function) =>
        files.has(path) ? done(null, { /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回布尔判定，供用例选择路径或核对受控条件。
         * Result: Return a boolean decision for path selection or controlled-condition assertions.
         * 验证场景 / Scenario: interrupted network changes can be restored but externally changed files are protected
         */
        isFile: () => true }) : done({ code: 2 }),
    })) as MachinesType['sftp'];
  locks.readGuestFile = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: _id; path。
   * 结果：返回分支计算值（`files.get(path)!`），以 Promise 交付。
   * Result: Return the branch-computed value (`files.get(path)!`) through a Promise.
   * 验证场景 / Scenario: interrupted network changes can be restored but externally changed files are protected
   * 协作入口 / Collaborators: `files.get`.
   */
  async (_id, path) => files.get(path)!;
  locks.writeGuestFile = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: _id; path; content。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: interrupted network changes can be restored but externally changed files are protected
   * 协作入口 / Collaborators: `files.set`.
   */
  async (_id, path, content) => {
    files.set(path, content);
  };
  locks.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ code: 0, stdout: '', stderr: '' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ code: 0, stdout: '', stderr: '' })`) through a Promise.
   * 验证场景 / Scenario: interrupted network changes can be restored but externally changed files are protected
   */
  async () => ({ code: 0, stdout: '', stderr: '' });
  const network = new NetworkProfiles(locks);
  try {
    const preview = await network.preview(id, { httpProxy: 'http://localhost:7890' });
    await assert.rejects(
      network.apply(id, { httpProxy: 'http://localhost:7891' }, preview.token),
      /重新预览/,
    );
    await network.apply(id, preview.config, preview.token);
    assert.ok((await network.environment(id)).HTTP_PROXY);
    files.set('/etc/profile.d/sakura-network.sh', 'external change');
    await assert.rejects(network.restore(id), /外部修改/);
    assert.equal(files.get('/etc/profile.d/sakura-network.sh'), 'external change');
    files.set('/etc/profile.d/sakura-network.sh', preview.changes[0].after);
    await network.restore(id);
    assert.equal(files.get('/etc/profile.d/sakura-network.sh'), 'before');
    assert.deepEqual(await network.environment(id), {});
  } finally {
    await network.close();
  }
});


/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: data migration cannot publish into a target owned by another host
 * 协作入口 / Collaborators: `join`, `mkdir`, `writeFile`, `DataDirectoryOwner.acquire`.
 * 检查边界 / Checked boundaries: `assert.equal(migration.jobs.view('data')?.status, 'error')`; `assert.match(migration.jobs.view('data')?.error || '', /数据目录已由另一宿主/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('data migration cannot publish into a target owned by another host', async () => {
  const source = join(root, 'owned-migration-source'), target = join(root, 'owned-migration-target');
  await mkdir(source); await writeFile(join(source, 'proof'), 'unchanged');
  const machines = new Machines({} as Engine, fakeVmNetwork), migration = new DataMigration(machines, () => [], source);
  const owner = await DataDirectoryOwner.acquire(target, { create: false });
  try {
    const plan = await migration.plan(target);
    await migration.start(target, plan.token); await migration.jobs.wait('data');
    assert.equal(migration.jobs.view('data')?.status, 'error');
    assert.match(migration.jobs.view('data')?.error || '', /数据目录已由另一宿主/);
    await assert.rejects(stat(target), { code: 'ENOENT' });
    assert.equal(await readFile(join(source, 'proof'), 'utf8'), 'unchanged');
    assert.equal(machines.maintenance, false);
  } finally { await owner.close(); await migration.close(); }
});
