/** 固定原生工具的AppContainer入口；owns a fixed native sandbox task until physical exit. */
import { readFile, mkdir, mkdtemp, lstat, realpath, writeFile, rm, open,readdir } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { storageRuntime } from './storage-runtime.ts';
import { hostProcess } from './host-process.ts';
import { type Data, assertBytes, cancelled, reject } from './seventh-creation-common.ts';

export type CreationNativeOptions = {
  assetRoot?: string;
  workRoot?: string;
  timeoutMs?: number;
  keepArtifacts?: boolean;
  /** 宿主固定票据的传输适配；仅内部调用，不接受客户端可执行路径。 */
  executor?: (action:'train'|'predict'|'solve'|'extract',input:Data,signal?:AbortSignal)=>Promise<unknown>;
};
const workspace = resolve(fileURLToPath(new URL('..', import.meta.url)));
async function directory(path: string) {
  for (let current = path; ; current = dirname(current)) {
    const info = await lstat(current);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      resolve(await realpath(current)).toLowerCase() !== resolve(current).toLowerCase()
    )
      reject('NATIVE_DIRECTORY_IDENTITY');
    if (current === dirname(current)) break;
  }
}
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
type NativeAssetProbeOptions=Pick<CreationNativeOptions,'assetRoot'>&{signal?:AbortSignal;owner?:string};
export type CreationNativeIdentity={manifestDigest:string;helperDigest:string;workerDigest:string};
type CreationNativeAssets=CreationNativeIdentity&{backend:'windows-appcontainer-job';platform:'win32';architecture:'x64';python:unknown;packages:unknown;runtimeBytes:number;assetBytes:number;verified:true};
/** 完整运行时核验必须发生在创建有启动期限的 guard 之前。 */
export function probeCreationNativeAssets(options:NativeAssetProbeOptions={}):Promise<CreationNativeAssets>{return probeNativeAssets(options,false);}
/** 原准备已持有 native 分区；启动前只重验同一清单及两个固定入口摘要。 */
export function probeCreationNativeIdentity(options:NativeAssetProbeOptions={}):Promise<CreationNativeIdentity>{return probeNativeAssets(options,true);}
async function probeNativeAssets(options:NativeAssetProbeOptions,identityOnly:true):Promise<CreationNativeIdentity>;
async function probeNativeAssets(options:NativeAssetProbeOptions,identityOnly:false):Promise<CreationNativeAssets>;
async function probeNativeAssets(options:NativeAssetProbeOptions,identityOnly:boolean):Promise<CreationNativeIdentity|CreationNativeAssets>{
  cancelled(options.signal);
  const assets = resolve(options.assetRoot ?? join(workspace, '.tools/seventh-creation'));
  await directory(assets);
  return storageRuntime.run(
    {
      owner: options.owner ?? 'seventh-creation-native',
      taskId: randomUUID(),
      label: identityOnly?'fixed-native-identity-verification':'fixed-native-runtime-verification',
      paths: [assets],
      mode: 'read',
      buffers: 4 * 1024 ** 2 + 65536,
      files: 1,
      signal: options.signal,
    },
    async (lease) => {
      async function inspect(path: string, maximum: number, collect = false) {
        cancelled(options.signal);
        const before = await lstat(path);
        if (
          !before.isFile() ||
          before.isSymbolicLink() ||
          before.size > maximum ||
          resolve(await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()
        )
          reject('NATIVE_ASSET_IDENTITY');
        const handle = await open(path, 'r');
        const hash = createHash('sha256'),
          parts: Buffer[] = [];
        let bytes = 0;
        const equal = (a: typeof before, b: typeof before) =>
          a.dev === b.dev &&
          a.ino === b.ino &&
          a.size === b.size &&
          a.mtimeMs === b.mtimeMs &&
          a.ctimeMs === b.ctimeMs;
        try {
          if (!equal(before, await handle.stat())) reject('NATIVE_ASSET_IDENTITY');
          const chunk = Buffer.alloc(65536);
          for (;;) {
            cancelled(options.signal);
            const result = await handle.read(chunk, 0, chunk.length, bytes);
            if (!result.bytesRead) break;
            bytes += result.bytesRead;
            if (bytes > maximum || bytes > before.size) reject('NATIVE_ASSET_SIZE');
            const portion = chunk.subarray(0, result.bytesRead);
            hash.update(portion);
            if (collect) parts.push(Buffer.from(portion));
          }
          if (
            bytes !== before.size ||
            !equal(before, await handle.stat()) ||
            !equal(before, await lstat(path))
          )
            reject('NATIVE_ASSET_CHANGED');
          return { digest: hash.digest('hex'), bytes, data: collect ? Buffer.concat(parts) : null };
        } finally {
          try {
            await handle.close();
          } catch (error) {
            lease.cleanupPending(error);
            throw error;
          }
        }
      }
      const manifestFile = await inspect(join(assets, 'runtime-manifest.json'), 4 * 1024 ** 2, true);
      const raw = manifestFile.data!;
      const manifest = JSON.parse(raw.toString('utf8')) as Data;
      if (
        manifest.schemaVersion !== 1 ||
        manifest.platform !== 'win32' ||
        manifest.architecture !== 'x64' ||
        manifest.backend !== 'windows-appcontainer-job' ||
        manifest.sessionProtocol !== 'guarded-native/1' ||
        !Array.isArray(manifest.files) ||
        manifest.files.length > 10000
      )
        reject('NATIVE_MANIFEST_SCHEMA');
      const helper = await inspect(join(assets, 'sandbox.exe'), 16 * 1024 ** 2);
      if (helper.digest !== manifest.helperSha256) reject('NATIVE_HELPER_DIGEST');
      const workerCopy = await inspect(join(assets, 'seventh-creation-native-worker.py'), 1024 * 1024);
      if (workerCopy.digest !== manifest.workerSha256) reject('NATIVE_WORKER_DIGEST');
      const identity={manifestDigest:manifestFile.digest,helperDigest:helper.digest,workerDigest:workerCopy.digest};
      if(identityOnly)return identity;
      let bytes = 0;
      const paths = new Set<string>();
      for (const entry of manifest.files as Data[]) {
        if (
          typeof entry.path !== 'string' ||
          !/^[-.a-zA-Z0-9_ /+]+$/.test(entry.path) ||
          entry.path.split('/').includes('..') ||
          entry.path.startsWith('/') ||
          !Number.isSafeInteger(entry.bytes) ||
          Number(entry.bytes) < 0
        )
          reject('NATIVE_MANIFEST_PATH');
        const path = resolve(assets, 'runtime', entry.path);
        const rel = relative(join(assets, 'runtime'), path);
        if (rel.startsWith('..') || isAbsolute(rel) || paths.has(path.toLowerCase()))
          reject('NATIVE_MANIFEST_PATH');
        paths.add(path.toLowerCase());
        const observed = await inspect(path, Number(entry.bytes));
        if (observed.digest !== entry.sha256) reject('NATIVE_ASSET_DIGEST');
        bytes += observed.bytes;
      }
      if (bytes !== manifest.runtimeBytes) reject('NATIVE_ASSET_SIZE');
      let nodes=0;const physical=new Set<string>();
      const inventory=async(path:string)=>{for(const entry of await readdir(path,{withFileTypes:true})){cancelled(options.signal);if(++nodes>20000||entry.isSymbolicLink())reject('NATIVE_ASSET_INVENTORY');const child=join(path,entry.name);if(entry.isDirectory()){await directory(child);await inventory(child);}else if(entry.isFile())physical.add(resolve(child).toLowerCase());else reject('NATIVE_ASSET_INVENTORY');}};
      await inventory(assets);const expected=new Set([...paths,join(assets,'sandbox.exe').toLowerCase(),join(assets,'seventh-creation-native-worker.py').toLowerCase(),join(assets,'runtime-manifest.json').toLowerCase()]);
      if(physical.size!==expected.size||[...physical].some(path=>!expected.has(path)))reject('NATIVE_ASSET_INVENTORY');
      return {
        backend: 'windows-appcontainer-job' as const,
        platform: 'win32' as const,
        architecture: 'x64' as const,
        python: manifest.python,
        packages: manifest.packages,
        runtimeBytes: bytes,
        assetBytes: bytes + helper.bytes + workerCopy.bytes + manifestFile.bytes,
        ...identity,
        verified: true as const,
      };
    },
  );
}
export async function runCreationNative(
  action: 'train' | 'predict' | 'solve' | 'extract',
  input: Data,
  signal?: AbortSignal,
  options: CreationNativeOptions = {},
): Promise<unknown> {
  if(options.executor)return options.executor(action,input,signal);
  if (process.platform !== 'win32' || process.arch !== 'x64') reject('NATIVE_PLATFORM_NOT_SUPPORTED');
  cancelled(signal);
  assertBytes(input, 16 * 1024 ** 2);
  const assets = resolve(options.assetRoot ?? join(workspace, '.tools/seventh-creation'));
  const workRoot = resolve(options.workRoot ?? join(workspace, '.data/seventh-creation'));
  await directory(assets);
  await mkdir(workRoot, { recursive: true });
  await directory(workRoot);
  const runtime = join(assets, 'runtime'),
    helper = join(assets, 'sandbox.exe');
  await directory(runtime);
  const source = await readFile(new URL('./seventh-creation-native-worker.py', import.meta.url)).catch(() =>
    readFile(join(assets, 'seventh-creation-native-worker.py')),
  );
  if (!source.equals(await readFile(join(runtime, 'seventh-creation-native-worker.py'))))
    reject('NATIVE_WORKER_DIGEST');
  const timeout = options.timeoutMs ?? 120000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 120000) reject('NATIVE_DEADLINE');
  const working = await mkdtemp(join(workRoot, 'native-'));
  await directory(working);
  const cleanupWorking = async () => {
    if (options.keepArtifacts) return;
    try {
      const rel = relative(workRoot, working);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) reject('NATIVE_CLEANUP_PATH');
      await directory(working);
      await rm(working, { recursive: true, force: false });
      for(const suffix of ['.receipt.json','.start.json'])await rm(working+suffix,{force:true});
    } catch (cause) {
      throw Object.assign(new Error('原生任务暂存清理尚未确认'), {
        code: 'NATIVE_CLEANUP_PENDING',
        working,
        cause,
      });
    }
  };
  let stopRequested = false;
  const cancel = () => {
    stopRequested = true;
    void writeFile(join(working, 'cancel.request'), 'cancel').catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  let result: Awaited<ReturnType<typeof hostProcess>>;
  try {
    // Leave ten seconds between the inner Job deadline and the outer native owner deadline.
    const innerTimeout = Math.min(timeout, 110000);
    result = await hostProcess('seventh-creation-sandbox', helper, [runtime, working, String(innerTimeout)], {
      input: JSON.stringify({ action, input }),
      timeout: Math.min(120000, innerTimeout + 10000),
      maxBuffer: 16 * 1024 ** 2,
      cwd: working,
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'HOST_PROCESS_OWNER_UNAVAILABLE') {
      await cleanupWorking();
      throw error;
    }
    throw Object.assign(new Error('原生宿主未返回创作工具的核销回执'), {
      code: 'NATIVE_CLEANUP_PENDING',
      working,
      cause: error,
    });
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  const diagnostic = result.stderr;
  const cleanupConfirmed = /SANDBOX_RECEIPT appcontainer=true networkCapabilities=0 activeProcesses=0 /.test(
    diagnostic,
  );
  if (!cleanupConfirmed)
    throw Object.assign(new Error('原生执行退出尚未核销'), { code: 'NATIVE_CLEANUP_PENDING', working });
  await cleanupWorking();
  let output: Data;
  try {
    output = JSON.parse(result.stdout) as Data;
  } catch {
    throw Object.assign(new Error('原生工具没有返回完整结果：' + diagnostic.slice(0, 4096)), {
      code: 'NATIVE_INVALID_OUTPUT',
      working,
    });
  }
  if (signal?.aborted) signal.throwIfAborted();
  if (stopRequested) reject('NATIVE_OUTPUT_LIMIT');
  if (result.code !== 0 || output.ok !== true)
    throw Object.assign(new Error(String(output.code ?? 'NATIVE_EXECUTION_FAILED')), {
      code: String(output.code ?? 'NATIVE_EXECUTION_FAILED'),
    });
  return {
    ...(output.result as Data),
    execution: {
      backend: 'windows-appcontainer-job',
      networkCapabilities: 0,
      cleanup: 'confirmed',
      receipt: diagnostic.trim(),
    },
  };
}
