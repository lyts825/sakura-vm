/** 固定原生任务的两阶段传输；恢复只核销原进程身份，不重放业务命令。 */
import { mkdir, readFile, writeFile, rename, lstat, realpath, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { hostProcess } from './host-process.ts';
import { type Data, assertBytes, cancelled, reject, digest } from './seventh-creation-common.ts';
import type { CreationNativeOptions } from './seventh-creation-native.ts';
import { serializedMetadata } from './metadata-queue.ts';
import { atomicMetadataWrite } from './metadata-io.ts';
const running = new Map<string, Promise<Awaited<ReturnType<typeof hostProcess>>>>();
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export type NativeSession = { working: string; assetRoot: string; workRoot: string };
async function identity(path: string, directory = false) {
  const info = await lstat(path);
  if (
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile()) ||
    resolve(await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()
  )
    reject('NATIVE_SESSION_IDENTITY');
  return info;
}
async function read(path: string, maximum: number) {
  const info = await identity(path);
  if (info.size > maximum) reject('NATIVE_SESSION_SIZE');
  const bytes = await readFile(path);
  const after = await identity(path);
  if (
    info.ino !== after.ino ||
    info.size !== after.size ||
    info.mtimeMs !== after.mtimeMs ||
    info.ctimeMs !== after.ctimeMs ||
    bytes.length !== info.size
  )
    reject('NATIVE_SESSION_CHANGED');
  return bytes;
}
export async function sessionReceipt(session: NativeSession): Promise<Data> {
  const receipt = JSON.parse((await read(session.working + '.receipt.json', 65536)).toString('utf8')) as Data;
  if (
    receipt.schemaVersion !== 1 ||
    String(receipt.working).toLowerCase() !== session.working.toLowerCase() ||
    String(receipt.runtime).toLowerCase() !== join(session.assetRoot, 'runtime').toLowerCase() ||
    receipt.guarded !== true
  )
    reject('NATIVE_SESSION_RECEIPT');
  return receipt;
}
export async function prepareCreationSession(
  id: string,
  options: CreationNativeOptions,
  signal?: AbortSignal,
): Promise<NativeSession> {
  if (!/^[a-f0-9-]{36}$/.test(id)) reject('NATIVE_SESSION_ID');
  cancelled(signal);
  const assetRoot = resolve(options.assetRoot!),
    workRoot = resolve(options.workRoot!),
    working = join(workRoot, 'task-' + id);
  await mkdir(workRoot, { recursive: true });
  await identity(workRoot, true);
  await mkdir(working);
  await identity(working, true);
  const session = { working, assetRoot, workRoot };
  const completion = hostProcess(
    'seventh-creation-sandbox',
    join(assetRoot, 'sandbox.exe'),
    ['--guard', join(assetRoot, 'runtime'), working, '110000'],
    { input: '', timeout: 120000, maxBuffer: 16 * 1024 ** 2, cwd: working },
  );
  running.set(working, completion);
  void completion.catch(() => {});
  const deadline = Date.now() + 9000;
  while (Date.now() < deadline) {
    cancelled(signal);
    try {
      const receipt = await sessionReceipt(session);
      if (receipt.status === 'prepared') return session;
    } catch (error) {
      // C# publishes preparing → prepared by atomic replacement. A read spanning
      // that replacement must fail identity checks and retry a fresh snapshot.
      if(!['ENOENT','NATIVE_SESSION_CHANGED','NATIVE_SESSION_IDENTITY'].includes(String((error as {code?:string}).code)))throw error;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  reject('NATIVE_PREPARE_PENDING');
}
export async function startCreationSession(
  session: NativeSession,
  action: string,
  input: Data,
  signal?: AbortSignal,
): Promise<unknown> {
  assertBytes(input, 16 * 1024 ** 2);
  let stopRequested = false;
  const cancel = () => {
    stopRequested = true;
    void writeFile(join(session.working, 'cancel.request'), 'cancel').catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    const completion = running.get(session.working);
    if (!completion) reject('NATIVE_SESSION_ORIGINAL_OWNER_LOST');
    const receipt = await sessionReceipt(session);
    if (receipt.status !== 'prepared') reject('NATIVE_SESSION_ALREADY_STARTED');
    if (!stopRequested) {
      const request = JSON.stringify({ action, input }),
        temporary = session.working + '.request.tmp';
      await writeFile(temporary, request, { flag: 'wx' });
      if (!stopRequested) await rename(temporary, session.working + '.start.json');
    }
    // Cancellation after rename still waits for the original owner and Job to exit.
    await completion;
    if (stopRequested) reject('NATIVE_CANCELLED');
    const actual = await readCreationSessionRequest(session);
    if (actual.action !== action || digest(actual.input) !== digest(input)) reject('NATIVE_INPUT_BINDING');
    return await readCreationSessionOutput(session);
  } finally {
    signal?.removeEventListener('abort', cancel);
    running.delete(session.working);
  }
}
export async function readCreationSessionRequest(
  session: NativeSession,
): Promise<{ action: string; input: Data }> {
  const bytes = await read(session.working + '.start.json', 16 * 1024 ** 2),
    receipt = await sessionReceipt(session);
  if (sha(bytes) !== receipt.inputDigest) reject('NATIVE_INPUT_DIGEST');
  return JSON.parse(bytes.toString('utf8')) as { action: string; input: Data };
}
export async function readCreationSessionOutput(session: NativeSession): Promise<unknown> {
  const receipt = await sessionReceipt(session);
  if (receipt.cleanup !== 'confirmed') reject('NATIVE_CLEANUP_PENDING');
  if (receipt.errorCode) reject(String(receipt.errorCode));
  if (receipt.status !== 'completed' && receipt.status !== 'failed') reject('NATIVE_CANCELLED');
  const bytes = await read(join(session.working, 'output.json'), 16 * 1024 ** 2);
  if (sha(bytes) !== receipt.outputDigest || bytes.length !== Number(receipt.outputBytes))
    reject('NATIVE_OUTPUT_DIGEST');
  const output = JSON.parse(bytes.toString('utf8')) as Data;
  if (receipt.exitCode !== 0 || output.ok !== true) reject(String(output.code ?? 'NATIVE_EXECUTION_FAILED'));
  return {
    ...(output.result as Data),
    execution: {
      backend: 'windows-appcontainer-job',
      networkCapabilities: 0,
      cleanup: 'confirmed',
      receipt: 'protected-original-job-receipt',
      pid: receipt.childPid,
    },
  };
}
export async function reconcileCreationSession(
  session: NativeSession,
  signal?: AbortSignal,
): Promise<'confirmed' | 'pending' | 'unknown'> {
  cancelled(signal);
  try {
    await sessionReceipt(session);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'unknown';
    throw error;
  }
  const result = await hostProcess(
    'seventh-creation-sandbox',
    join(session.assetRoot, 'sandbox.exe'),
    ['--reconcile', join(session.assetRoot, 'runtime'), session.working],
    { input: '', timeout: 20000, maxBuffer: 65536, cwd: session.workRoot },
  );
  const original = running.get(session.working);
  if (original) {
    await original.catch(() => {});
    running.delete(session.working);
  }
  if (result.code !== 0) return 'pending';
  const output = JSON.parse(result.stdout) as Data;
  return output.ok === true && (output.result as Data)?.cleanup === 'confirmed' ? 'confirmed' : 'pending';
}
export async function eraseCreationSession(session: NativeSession) {
  const rel = relative(session.workRoot, session.working);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !/^task-[a-f0-9-]{36}$/.test(rel))
    reject('NATIVE_CLEANUP_PATH');
  try {
    await identity(session.working, true);
    await rm(session.working, { recursive: true, force: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const suffix of ['.receipt.json', '.start.json', '.request.tmp', '.result.json', '.payload.json'])
    await rm(session.working + suffix, { force: true });
}
export async function saveCreationSessionPayload(session: NativeSession, input: Data) {
  assertBytes(input, 16 * 1024 ** 2);
  await publishSessionData(session.working + '.payload.json', JSON.stringify(input));
}
export async function loadCreationSessionPayload(session: NativeSession) {
  return JSON.parse((await read(session.working + '.payload.json', 16 * 1024 ** 2)).toString('utf8')) as Data;
}
export async function saveCreationSessionResult(session: NativeSession, output: unknown) {
  const bytes = Buffer.from(JSON.stringify(output));
  if (bytes.length > 16 * 1024 ** 2) reject('NATIVE_RESULT_LIMIT');
  await publishSessionData(session.working + '.result.json', bytes.toString('utf8'));
  return { digest: sha(bytes), bytes: bytes.length };
}
export async function loadCreationSessionResult(session: NativeSession, expected: string) {
  const bytes = await read(session.working + '.result.json', 16 * 1024 ** 2);
  if (sha(bytes) !== expected) reject('NATIVE_RESULT_DIGEST');
  return JSON.parse(bytes.toString('utf8')) as unknown;
}
/** 固定正文以原字节比较，复用现有队列、fsync 与原子发布入口。 */
async function publishSessionData(path: string, contents: string) {
  return serializedMetadata(path, true, async (mark) => {
    try {
      const previous = await read(path, 16 * 1024 ** 2);
      if (previous.toString('utf8') !== contents) reject('NATIVE_SESSION_DATA_CHANGED');
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await atomicMetadataWrite(path, contents, undefined, mark);
  });
}
