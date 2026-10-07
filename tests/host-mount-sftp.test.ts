/**
 * 模块职责：回归验证模块，围绕 `host-mount-sftp` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `host-mount-sftp`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: host share maps only ordinary paths below configured root; SFTP share reads and writes files while denying parent paths and links.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client, type SFTPWrapper } from 'ssh2';
import { test } from 'node:test';
import { hostMountPath, serveHostMount } from '../server/host-mount-sftp.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-host-mount-test-'));
const shared = join(root, 'shared');
await mkdir(shared);
await writeFile(join(shared, 'hello.txt'), 'host-data');

/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: port: number; privateKey: string。
 * 结果：返回受控对象，公开字段包括 `client, ftp`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `client, ftp`; the actual branch determines its shape.
 */
async function connect(port: number, privateKey: string) {
  const client = new Client();
  await new Promise<void>((done, reject) => {
    client.once('ready', done).once('error', reject);
    client.connect({ host: '127.0.0.1', port, username: 'sakura-host', privateKey,
      readyTimeout: 5000 });
  });
  const ftp = await new Promise<SFTPWrapper>((done, reject) =>
    client.sftp((error, result) => error ? reject(error) : done(result)));
  return { client, ftp };
}
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: ftp: SFTPWrapper; path: string。
 * 结果：返回分支计算值（`new Promise<void>((done, reject) => ftp.stat(path, (error) => error ? reject(err…`）。
 * Result: Return the branch-computed value (`new Promise<void>((done, reject) => ftp.stat(path, (error) => error ? reject(err…`).
 */
const stat = (ftp: SFTPWrapper, path: string) => new Promise<void>((done, reject) =>
  ftp.stat(path, (error) => error ? reject(error) : done()));
/**
 * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
 * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
 * 输入 / Inputs: ftp: SFTPWrapper; path: string; content: string。
 * 结果：返回分支计算值（`new Promise<void>((done, reject) => { const stream = ftp.createWriteStream(path)…`）。
 * Result: Return the branch-computed value (`new Promise<void>((done, reject) => { const stream = ftp.createWriteStream(path)…`).
 */
const write = (ftp: SFTPWrapper, path: string, content: string) => new Promise<void>((done, reject) => {
  const stream = ftp.createWriteStream(path);
  stream.once('error', reject).once('close', done).end(content);
});
/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: ftp: SFTPWrapper; path: string。
 * 结果：返回分支计算值（`new Promise<string>((done, reject) => { const chunks: Buffer[] = []; ftp.createR…`）。
 * Result: Return the branch-computed value (`new Promise<string>((done, reject) => { const chunks: Buffer[] = []; ftp.createR…`).
 */
const read = (ftp: SFTPWrapper, path: string) => new Promise<string>((done, reject) => {
  const chunks: Buffer[] = [];
  ftp.createReadStream(path).on('data', (chunk: Buffer) => chunks.push(chunk))
    .once('error', reject).once('close', () => done(Buffer.concat(chunks).toString()));
});

test.after(async () => {
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\') ||
    resolve(root).startsWith(resolve(tmpdir()) + '/'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: host share maps only ordinary paths below configured root
 * 协作入口 / Collaborators: `assert.equal`, `hostMountPath`, `join`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.equal(hostMountPath(shared, '/hello.txt'), join(shared, 'hello.txt'))`; `assert.throws(() => hostMountPath(shared, '/../outside.txt'))`.
 */
test('host share maps only ordinary paths below configured root', () => {
  assert.equal(hostMountPath(shared, '/hello.txt'), join(shared, 'hello.txt'));
  assert.throws(() => hostMountPath(shared, '/../outside.txt'));
  assert.throws(() => hostMountPath(shared, '/sub\\..\\outside.txt'));
  assert.throws(() => hostMountPath(shared, '/file:stream'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SFTP share reads and writes files while denying parent paths and links
 * 失败 / Failure: `error`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `serveHostMount`, `connect`, `assert.equal`, `read`.
 * 检查边界 / Checked boundaries: `assert.equal(await read(ftp, '/hello.txt'), 'host-data')`; `assert.equal(await readFile(join(shared, 'written.txt'), 'utf8'), 'guest-data')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('SFTP share reads and writes files while denying parent paths and links', async () => {
  const server = await serveHostMount(shared, false);
  const { client, ftp } = await connect(server.port, server.clientPrivate);
  try {
    assert.equal(await read(ftp, '/hello.txt'), 'host-data');
    await write(ftp, '/written.txt', 'guest-data');
    assert.equal(await readFile(join(shared, 'written.txt'), 'utf8'), 'guest-data');
    await assert.rejects(stat(ftp, '/../outside.txt'), (error: any) => error.code === 3);
    await assert.rejects(stat(ftp, '/hello.txt/../../outside.txt'), (error: any) =>
      error.code === 3);
    await assert.rejects(new Promise<void>((done, reject) =>
      ftp.rmdir('/', (error) => error ? reject(error) : done())),
    (error: any) => error.code === 3);
    try {
      await symlink(root, join(shared, 'escape'), 'junction');
      await assert.rejects(stat(ftp, '/escape/outside.txt'), (error: any) => error.code === 3);
    } catch (error: any) {
      if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    }
  } finally { client.end(); await server.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: read-only SFTP share rejects mutations
 * 协作入口 / Collaborators: `serveHostMount`, `connect`, `assert.equal`, `read`.
 * 检查边界 / Checked boundaries: `assert.equal(await read(ftp, '/hello.txt'), 'host-data')`; `assert.rejects(write(ftp, '/denied.txt', 'bad'), (error: any) => error.code === 3)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('read-only SFTP share rejects mutations', async () => {
  const server = await serveHostMount(shared, true);
  const { client, ftp } = await connect(server.port, server.clientPrivate);
  try {
    assert.equal(await read(ftp, '/hello.txt'), 'host-data');
    await assert.rejects(write(ftp, '/denied.txt', 'bad'), (error: any) => error.code === 3);
    await assert.rejects(new Promise<void>((done, reject) =>
      ftp.unlink('/hello.txt', (error) => error ? reject(error) : done())),
    (error: any) => error.code === 3);
    assert.equal(await readFile(join(shared, 'hello.txt'), 'utf8'), 'host-data');
  } finally { client.end(); await server.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: closing the share disconnects an active SFTP client
 * 协作入口 / Collaborators: `serveHostMount`, `connect`, `stat`, `Promise.race`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('closing the share disconnects an active SFTP client', async () => {
  const server = await serveHostMount(shared, true);
  const { client, ftp } = await connect(server.port, server.clientPrivate);
  try {
    await stat(ftp, '/hello.txt');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([server.close(), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('host share did not close')), 3000);
      })]);
    } finally { clearTimeout(timeout); }
  } finally { client.destroy(); }
});
