/**
 * 模块职责：回归验证模块，围绕 `local-assistant` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `local-assistant`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: assistant redaction covers complete and partial keys, credentials, headers, URL credentials and known tokens; actual HTTP model discovery, preflight and generation send only reviewed text; context and answers never persist.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { LocalAssistant } from '../server/local-assistant.ts';
import { redactAssistantContext } from '../shared/assistant.ts';

const settings = {
  enabled: true,
  endpoint: 'http://127.0.0.1:11434',
  model: 'fixture:local',
  timeoutSeconds: 10,
  maxTokens: 1024,
};
const info = { details: { format: 'gguf' }, model_info: { 'general.architecture': 'fixture' } };
const plan = {
  goal: '查看状态',
  assumptions: ['已进入项目目录'],
  steps: [
    { purpose: '读取 Git 状态', command: 'git status --short', risk: 'read', verify: '检查输出和退出状态' },
  ],
};
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: content = 'Model answer'。
 * 结果：返回分支计算值（`({ model: settings.model, done: true, message: { role: 'assistant', content }, }…`）。
 * Result: Return the branch-computed value (`({ model: settings.model, done: true, message: { role: 'assistant', content }, }…`).
 */
const answer = (content = 'Model answer') => ({
  model: settings.model,
  done: true,
  message: { role: 'assistant', content },
});
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: test.TestContext; fetcher: typeof fetch。
 * 结果：返回受控对象，公开字段包括 `file, create, advance`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `file, create, advance`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))`.
 */
async function fixture(t: test.TestContext, fetcher?: typeof fetch) {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-local-assistant-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  const file = join(directory, 'assistant.json');
  let now = Date.now();
  const managers: LocalAssistant[] = [];
  /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`manager`），以 Promise 交付。
   * Result: Return the branch-computed value (`manager`) through a Promise.
   * 协作入口 / Collaborators: `managers.push`, `manager.init`.
   */
  const create = async () => {
    const manager = new LocalAssistant(file, fetcher, () => now);
    managers.push(manager);
    await manager.init();
    return manager;
  };
  t.after(async () => {
    for (const manager of managers) await manager.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    file,
    create,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: ms: number。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: assistant redaction covers complete and partial keys, credentials, headers, URL credentials and known tokens
 * 协作入口 / Collaborators: `redactAssistantContext`, `assert.ok`, `result.content.includes`, `headers.content.includes`.
 * 检查边界 / Checked boundaries: `assert.ok(result.redactions >= 8)`; `assert.ok(result.content.includes('safe code'))`.
 */
test('assistant redaction covers complete and partial keys, credentials, headers, URL credentials and known tokens', () => {
  const secrets = [
    'PRIVATE_CONTENT',
    'PRIVATE_PARTIAL',
    'my secret password',
    'bearer-private-value',
    'query-private',
    'uri-private',
    'sk-abcdefghijklmnopqrstuvwx',
    'AKIA1234567890123456',
  ];
  const source = `safe code\n-----BEGIN OPENSSH PRIVATE KEY-----\n${secrets[0]}\n-----END OPENSSH PRIVATE KEY-----\npassword = "${secrets[2]}"\nAuthorization: Bearer ${secrets[3]}\nhttps://name:${secrets[5]}@example.invalid/?token=${secrets[4]}\n${secrets[6]}\n${secrets[7]}\n-----BEGIN PRIVATE KEY-----\n${secrets[1]}`;
  const result = redactAssistantContext(source);
  assert.ok(result.redactions >= 8);
  assert.ok(result.content.includes('safe code'));
  for (const secret of secrets) assert.ok(!result.content.includes(secret), secret);
  const headers = redactAssistantContext(
    '"Authorization": "Bearer HIDDEN_JSON_HEADER"\nDATABASE_PASSWORD=HIDDEN_DB_VALUE\nOPENAI_API_KEY=HIDDEN_ENV_VALUE',
  );
  assert.ok(!headers.content.includes('HIDDEN_'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: actual HTTP model discovery, preflight and generation send only reviewed text; context and answers never persist
 * 协作入口 / Collaborators: `createServer`, `t.after`, `fixture`, `f.create`.
 * 检查边界 / Checked boundaries: `assert.deepEqual( (await assistant.models()).models.map((model) => model.name), [settings.model], )`; `assert.equal(requests.length, 1, 'preview never contacts a model')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('actual HTTP model discovery, preflight and generation send only reviewed text; context and answers never persist', async (t) => {
  const requests: { path: string; body: any }[] = [];
  const server = createServer(/**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: req; res。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: actual HTTP model discovery, preflight and generation send only reviewed text; context and answers never persist
   * 状态影响 / State effects: `content`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `JSON.parse`, `requests.push`, `answer`, `JSON.stringify`.
   */
  async (req, res) => {
    let content = '';
    for await (const chunk of req) content += chunk;
    const body = content ? JSON.parse(content) : undefined;
    requests.push({ path: req.url!, body });
    const result =
      req.url === '/api/tags'
        ? {
            models: [
              { name: settings.model, size: 100, details: { format: 'gguf' } },
              { name: 'remote:cloud', size: 0, remote_host: 'remote', details: { format: 'gguf' } },
            ],
          }
        : req.url === '/api/show'
          ? info
          : answer(body.format ? JSON.stringify(plan) : 'Use an explicit assertion.');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const f = await fixture(t),
    assistant = await f.create();
  await assistant.configure(1, {
    ...settings,
    endpoint: `http://127.0.0.1:${(server.address() as any).port}`,
  });
  assert.deepEqual(
    (await assistant.models()).models.map((model) => model.name),
    [settings.model],
  );
  const preview = assistant.preview({
    mode: 'tests',
    instruction: 'Create tests',
    context: 'password = SECRET_FOR_TEST\nconst total = 3;',
  });
  assert.equal(requests.length, 1, 'preview never contacts a model');
  assert.ok(!preview.content.includes('SECRET_FOR_TEST'));
  const result = await assistant.generate(preview.id);
  assert.equal(result.content, 'Use an explicit assertion.');
  const sent = requests.find((item) => item.path === '/api/chat')!.body;
  assert.equal(sent.stream, false);
  assert.equal(sent.options.num_predict, 1024);
  assert.equal(sent.messages[1].content, preview.content);
  assert.ok(!JSON.stringify(sent).includes('SECRET_FOR_TEST'));
  assert.equal(sent.tools, undefined);
  await assert.rejects(assistant.generate(preview.id), /过期/);
  const planned = await assistant.generate(
    assistant.preview({ mode: 'plan', instruction: '查看项目状态' }).id,
  );
  assert.deepEqual(planned.plan, plan);
  assert.ok(requests.at(-1)!.body.format.properties.steps);
  const stored = await readFile(f.file, 'utf8');
  for (const value of ['SECRET_FOR_TEST', 'Create tests', 'Use an explicit assertion', 'git status'])
    assert.ok(!stored.includes(value));
  await assistant.close();
  const restored = await f.create();
  assert.equal(restored.view().settings.model, settings.model);
  await assert.rejects(restored.generate(preview.id), /过期/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: expired previews, unsupported URLs, disabled integration and cloud aliases are rejected before sending context
 * 状态影响 / State effects: `preview`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.create`, `assert.rejects`, `assistant.models`.
 * 检查边界 / Checked boundaries: `assert.rejects(assistant.models(), /启用/)`; `assert.throws(() => assistant.configure(1, { ...settings, endpoint }))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('expired previews, unsupported URLs, disabled integration and cloud aliases are rejected before sending context', async (t) => {
  let chats = 0;
  const f = await fixture(t, async (url, init) => {
    assert.equal(init?.redirect, 'error');
    if (String(url).endsWith('/api/chat')) {
      chats++;
      return Response.json(answer());
    }
    return Response.json({ ...info, remote_model: 'remote-model', remote_host: 'https://remote.invalid' });
  });
  const assistant = await f.create();
  await assert.rejects(assistant.models(), /启用/);
  for (const endpoint of [
    'https://remote.invalid',
    'http://127.0.0.1/api',
    'http://127.0.0.1/?token=x',
    'http://user:pw@localhost',
    'file:///model',
  ])
    assert.throws(() => assistant.configure(1, { ...settings, endpoint }));
  await assistant.configure(1, settings);
  let preview = assistant.preview({ mode: 'ask', instruction: 'secret context' });
  await assert.rejects(assistant.generate(preview.id), /远程转发/);
  assert.equal(chats, 0);
  preview = assistant.preview({ mode: 'ask', instruction: 'expired' });
  f.advance(300001);
  await assert.rejects(assistant.generate(preview.id), /过期/);
  preview = assistant.preview({ mode: 'ask', instruction: 'stale configuration' });
  await assistant.configure(2, { ...settings, maxTokens: 2048 });
  await assert.rejects(assistant.generate(preview.id), /过期/);
  await assert.rejects(assistant.configure(2, settings), /已变化/);
  preview = assistant.preview({ mode: 'ask', instruction: 'prepared before locking' });
  assistant.revoke();
  await assert.rejects(assistant.generate(preview.id), /过期/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: invalid plans, incomplete answers, tool requests and oversized model responses never become actionable results
 * 状态影响 / State effects: `output`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `answer`, `fixture`, `f.create`, `assistant.configure`.
 * 检查边界 / Checked boundaries: `assert.rejects( assistant.generate(assistant.preview({ mode: 'plan', instruction: 'plan' }).id), /完整的命令计划/, )`; `assert.rejects( assistant.generate(assistant.preview({ mode: 'ask', instruction: 'answer' }).id), /响应/, )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('invalid plans, incomplete answers, tool requests and oversized model responses never become actionable results', async (t) => {
  let output: any = answer('not json');
  const f = await fixture(t, async (url) =>
    String(url).endsWith('/api/show') ? Response.json(info) : Response.json(output),
  );
  const assistant = await f.create();
  await assistant.configure(1, settings);
  await assert.rejects(
    assistant.generate(assistant.preview({ mode: 'plan', instruction: 'plan' }).id),
    /完整的命令计划/,
  );
  output = { ...answer('unfinished'), done: false };
  await assert.rejects(
    assistant.generate(assistant.preview({ mode: 'ask', instruction: 'answer' }).id),
    /响应/,
  );
  output = { ...answer(), message: { role: 'assistant', content: 'run a tool', tool_calls: [{}] } };
  await assert.rejects(
    assistant.generate(assistant.preview({ mode: 'ask', instruction: 'answer' }).id),
    /工具调用/,
  );
  output = answer('x'.repeat(1024 * 1024));
  await assert.rejects(
    assistant.generate(assistant.preview({ mode: 'ask', instruction: 'answer' }).id),
    /1 MiB/,
  );
  output = { ...answer('truncated but viewable'), done_reason: 'length' };
  assert.equal(
    (await assistant.generate(assistant.preview({ mode: 'ask', instruction: 'answer' }).id)).truncated,
    true,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: only one model operation runs, disconnect cancellation releases it, and shutdown aborts pending work
 * 状态影响 / State effects: `ready`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.create`, `assistant.configure`, `assistant.models`.
 * 检查边界 / Checked boundaries: `assert.rejects(assistant.models(), (error: any) => error.status === 429)`; `assert.rejects(first, /取消/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('only one model operation runs, disconnect cancellation releases it, and shutdown aborts pending work', async (t) => {
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  let ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = await fixture(t, async (_url, init) => {
    entered();
    return new Promise((_resolve, reject) =>
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
    );
  });
  const assistant = await f.create();
  await assistant.configure(1, settings);
  const cancel = new AbortController();
  const first = assistant.models(cancel.signal);
  await ready;
  await assert.rejects(assistant.models(), (error: any) => error.status === 429);
  cancel.abort();
  await assert.rejects(first, /取消/);
  assert.equal(assistant.view().busy, false);
  ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const second = assistant.models();
  await ready;
  const rejected = assert.rejects(second, /取消/);
  await assistant.close();
  await rejected;
  assert.equal(assistant.view().busy, false);
  await assert.rejects(assistant.models(), /关闭/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: saving new model settings cancels an in-flight request and never forwards old context to the new endpoint
 * 协作入口 / Collaborators: `fixture`, `f.create`, `assistant.configure`, `assistant.generate`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, /取消/)`; `assert.equal(calls.length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('saving new model settings cancels an in-flight request and never forwards old context to the new endpoint', async (t) => {
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const calls: string[] = [];
  const f = await fixture(t, async (url, init) => {
    calls.push(String(url));
    entered();
    return new Promise((_resolve, reject) =>
      init!.signal!.addEventListener('abort', () => reject(new Error('changed')), { once: true }),
    );
  });
  const assistant = await f.create();
  await assistant.configure(1, settings);
  const pending = assistant.generate(assistant.preview({ mode: 'ask', instruction: 'private input' }).id);
  await ready;
  const rejected = assert.rejects(pending, /取消/);
  await assistant.configure(2, { ...settings, endpoint: 'http://127.0.0.1:11435' });
  await rejected;
  assert.equal(calls.length, 1);
  assert.ok(calls[0].endsWith('/api/show'));
  assert.ok(!calls.some((url) => url.includes('11435')));
});
