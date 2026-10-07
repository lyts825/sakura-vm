/**
 * 模块职责：回归验证模块，围绕 `team-templates` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `team-templates`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: team templates preview and copy safe project and resource settings; team template mutation rejects stale source, failed target setup cleans the new instance, and corrupt state fails closed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeamTemplates } from '../server/team-templates.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: team templates preview and copy safe project and resource settings
 * 状态影响 / State effects: `source.memoryMiB`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `catalog.action`.
 * 检查边界 / Checked boundaries: `assert.equal(preview.ready, true)`; `assert.equal(preview.content.resources.memoryMiB, 1536)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('team templates preview and copy safe project and resource settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-team-template-'));
  const file = join(directory, 'templates.json');
  const source = { id: 'source', cpus: 3, memoryMiB: 1536, diskGiB: 12,
    accelerator: 'auto', distro: 'alpine', firmware: 'bios' };
  const created: Record<string, unknown>[] = [];
  const saved: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`id === 'source' ? source : { id }`）。
     * Result: Return the branch-computed value (`id === 'source' ? source : { id }`).
     * 验证场景 / Scenario: team templates preview and copy safe project and resource settings
     */
    get: (id: string) => id === 'source' ? source : { id },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _key: string; work: () => Promise<unknown>。
     * 结果：返回分支计算值（`work()`），以 Promise 交付。
     * Result: Return the branch-computed value (`work()`) through a Promise.
     * 验证场景 / Scenario: team templates preview and copy safe project and resource settings
     * 协作入口 / Collaborators: `work`.
     */
    locked: async (_key: string, work: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => work(),
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: input: Record<string, unknown>。
     * 结果：返回受控对象，公开字段包括 `id`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `id`; the actual branch determines its shape.
     * 验证场景 / Scenario: team templates preview and copy safe project and resource settings
     * 协作入口 / Collaborators: `created.push`.
     */
    create: async (input: Record<string, unknown>) => { created.push(input); return { id: 'new-vm' }; },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: id: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: team templates preview and copy safe project and resource settings
     * 协作入口 / Collaborators: `deleted.push`.
     */
    delete: async (id: string) => { deleted.push(id); },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`({ id, name: created.at(-1)?.name })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ id, name: created.at(-1)?.name })`) through a Promise.
     * 验证场景 / Scenario: team templates preview and copy safe project and resource settings
     * 协作入口 / Collaborators: `created.at`.
     */
    view: async (id: string) => ({ id, name: created.at(-1)?.name }),
  };
  const project = {
    directory: '/workspace/private', template: 'node',
    repository: 'https://user:password@example.invalid/private.git',
    setup: 'echo a-secret', command: 'echo another-secret',
    environment: { TOKEN: 'do-not-copy' }, secrets: { TOKEN: 'private-key' },
    previewPort: 3000, runtimes: { node: '22.12.0' },
    services: [{ name: 'secret-service', command: 'echo do-not-copy' }],
  };
  const workspaces = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     * 验证场景 / Scenario: team templates preview and copy safe project and resource settings
     */
    config: async () => project,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: id: string; content: Record<string, unknown>。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: team templates preview and copy safe project and resource settings
     * 协作入口 / Collaborators: `saved.push`.
     */
    save: async (id: string, content: Record<string, unknown>) => { saved.push({ id, content }); },
  };
  const catalog = new TeamTemplates(machines as never, workspaces as never, file);
  try {
    const preview = await catalog.action('source', { mode: 'capture', name: 'Node starter' }, 'check') as any;
    assert.equal(preview.ready, true);
    assert.equal(preview.content.resources.memoryMiB, 1536);
    assert.equal(preview.content.project.directory, '/workspace');
    assert.equal(preview.content.project.repository, '');
    assert.ok(!JSON.stringify(preview).includes('do-not-copy'));
    assert.ok(!JSON.stringify(preview).includes('password'));
    await assert.rejects(catalog.action('source', { mode: 'capture', name: 'Node starter',
      fingerprint: '0'.repeat(64) }, 'run'), /重新预览/);
    const capture = await catalog.action('source', { mode: 'capture', name: 'Node starter',
      fingerprint: preview.fingerprint }, 'run') as any;
    assert.equal(capture.template.version, 1);
    const listed = await catalog.action('source', { mode: 'list' }, 'check') as any;
    assert.equal(listed.templates.length, 1);
    assert.ok(!Object.hasOwn(listed.templates[0], 'content'));
    const templateId = capture.template.id;
    const inspected = await catalog.action('source', { mode: 'create', templateId,
      targetName: 'new-workspace' }, 'check') as any;
    assert.equal(inspected.template.fingerprint, preview.fingerprint);
    await assert.rejects(catalog.action('source', { mode: 'create', templateId,
      targetName: 'new-workspace', fingerprint: '0'.repeat(64) }, 'run'), /重新预览/);
    const result = await catalog.action('source', { mode: 'create', templateId,
      targetName: 'new-workspace', fingerprint: preview.fingerprint }, 'run') as any;
    assert.equal(result.vmId, 'new-vm');
    assert.equal(created[0].forwards instanceof Array, true);
    assert.equal((created[0].forwards as unknown[]).length, 0);
    assert.equal((saved[0].content as any).template, 'node');
    assert.equal((saved[0].content as any).repository, '');
    assert.equal(deleted.length, 0);
    assert.ok(!JSON.stringify(await readFile(file, 'utf8')).includes('do-not-copy'));
    source.memoryMiB = 2048;
    const updatePreview = await catalog.action('source', { mode: 'capture', name: 'Node starter',
      templateId }, 'check') as any;
    assert.equal(updatePreview.previousFingerprint, preview.fingerprint);
    await assert.rejects(catalog.action('source', { mode: 'capture', name: 'Node starter',
      templateId, fingerprint: updatePreview.fingerprint }, 'run'), /重新预览/);
    const updated = await catalog.action('source', { mode: 'capture', name: 'Node starter',
      templateId, fingerprint: updatePreview.fingerprint,
      previousFingerprint: updatePreview.previousFingerprint }, 'run') as any;
    assert.equal(updated.template.version, 2);
    assert.equal(updated.template.content.resources.memoryMiB, 2048);
    const removed = await catalog.action('source', { mode: 'delete', templateId,
      fingerprint: updatePreview.fingerprint }, 'run') as any;
    assert.equal(removed.deleted, templateId);
    assert.equal((await catalog.action('source', { mode: 'list' }, 'check') as any).templates.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: team template mutation rejects stale source, failed target setup cleans the new instance, and corrupt state fails closed
 * 状态影响 / State effects: `repository`, `state.templates[0].content.project.repository`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `catalog.action`.
 * 检查边界 / Checked boundaries: `assert.rejects(catalog.action('source', { mode: 'capture', name: 'Starter', fingerprint: first.fingerprint }, 'run'), /重新预览/)`; `assert.rejects(catalog.action('source', { mode: 'create', templateId: captured.template.id, fingerprint: second.fingerprint, targe…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('team template mutation rejects stale source, failed target setup cleans the new instance, and corrupt state fails closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-team-template-'));
  const file = join(directory, 'templates.json');
  const source = { id: 'source', cpus: 2, memoryMiB: 1024, diskGiB: 8,
    accelerator: 'auto', distro: 'alpine', firmware: 'bios' };
  const removed: string[] = [];
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`source`）。
     * Result: Return the branch-computed value (`source`).
     * 验证场景 / Scenario: team template mutation rejects stale source, failed target setup cleans the new instance, and corrupt state fails closed
     */
    get: () => source,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _key: string; work: () => Promise<unknown>。
     * 结果：返回分支计算值（`work()`），以 Promise 交付。
     * Result: Return the branch-computed value (`work()`) through a Promise.
     * 验证场景 / Scenario: team template mutation rejects stale source, failed target setup cleans the new instance, and corrupt state fails closed
     * 协作入口 / Collaborators: `work`.
     */
    locked: async (_key: string, work: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => work(),
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id: 'failed-vm' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ id: 'failed-vm' })`) through a Promise.
     * 验证场景 / Scenario: team template mutation rejects stale source, failed target setup cleans the new instance, and corrupt state fails closed
     */
    create: async () => ({ id: 'failed-vm' }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: id: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: team template mutation rejects stale source, failed target setup cleans the new instance, and corrupt state fails closed
     * 协作入口 / Collaborators: `removed.push`.
     */
    delete: async (id: string) => { removed.push(id); },
  };
  let repository = 'https://example.invalid/repo.git';
  const workspaces = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ directory: '/workspace', template: 'node', repository })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ directory: '/workspace', template: 'node', repository })`) through a Promise.
     * 验证场景 / Scenario: team template mutation rejects stale source, failed target setup cleans the new instance, and corrupt state fails closed
     */
    config: async () => ({ directory: '/workspace', template: 'node', repository }),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: team template mutation rejects stale source, failed target setup cleans the new instance, and corrupt state fails closed
     * 失败 / Failure: `new Error('setup failed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    save: async () => { throw new Error('setup failed'); },
  };
  const catalog = new TeamTemplates(machines as never, workspaces as never, file);
  try {
    const first = await catalog.action('source', { mode: 'capture', name: 'Starter' }, 'check') as any;
    repository = 'https://example.invalid/changed.git';
    await assert.rejects(catalog.action('source', { mode: 'capture', name: 'Starter',
      fingerprint: first.fingerprint }, 'run'), /重新预览/);
    const second = await catalog.action('source', { mode: 'capture', name: 'Starter' }, 'check') as any;
    const captured = await catalog.action('source', { mode: 'capture', name: 'Starter',
      fingerprint: second.fingerprint }, 'run') as any;
    await assert.rejects(catalog.action('source', { mode: 'create',
      templateId: captured.template.id, fingerprint: second.fingerprint,
      targetName: 'failed-target' }, 'run'), /setup failed/);
    assert.deepEqual(removed, ['failed-vm']);
    const state = JSON.parse(await readFile(file, 'utf8'));
    state.templates[0].content.project.repository = 'https://evil.invalid/changed.git';
    await writeFile(file, JSON.stringify(state));
    await assert.rejects(catalog.action('source', { mode: 'list' }, 'check'), /校验失败/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
