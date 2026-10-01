import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import { dirname, join, win32 } from 'node:path';
import { z } from 'zod';
import { AppError, DATA, ROOT } from './model.ts';
import { fileHash, readStore, regularDirectory, writeStore } from './local-store.ts';
import type { ClipboardRule } from '../shared/clipboard-policy.ts';
import type {
  NativeClipboardProcess,
  NativeClipboardProcessState,
  NativeClipboardView,
} from '../shared/native-clipboard.ts';

const executable = z
  .string()
  .min(7)
  .max(1024)
  .refine(
    (value) =>
      /^[a-z]:[\\/]/i.test(value) &&
      win32.extname(value).toLowerCase() === '.exe' &&
      !/[\x00-\x1f"<>|?*]/.test(value) &&
      !value.slice(2).includes(':') &&
      !value.split(/[\\/]/).some((part) => part === '.' || part === '..' || /[. ]$/.test(part)),
    '需要本机驱动器中的完整 EXE 路径',
  );
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const rule = z
  .object({
    copy: z.boolean(),
    paste: z.boolean(),
    files: z.boolean(),
    sensitive: z.boolean(),
    maxTextBytes: z.number().int().min(1024).max(1048576),
  })
  .strict();
const application = z.object({ image: executable, sha256: digest, rule }).strict();
const samePath = (value: string) => win32.normalize(value).toLowerCase();
export const nativeClipboardSettings = z
  .object({
    enabled: z.boolean(),
    applications: z.array(application).max(32),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.applications.map((item) => samePath(item.image))).size === value.applications.length,
    '应用路径不能重复',
  );
export const nativeClipboardRequest = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('configure'),
      version: z.number().int().positive(),
      settings: nativeClipboardSettings,
    })
    .strict(),
  z
    .object({
      action: z.literal('identify'),
      pid: z.number().int().positive(),
      created: z.string().regex(/^[1-9][0-9]{0,19}$/),
    })
    .strict(),
  z.object({ action: z.literal('refresh') }).strict(),
  z
    .object({
      action: z.literal('launch'),
      version: z.number().int().positive(),
      image: executable,
      sha256: digest,
      args: z
        .array(
          z
            .string()
            .max(2048)
            .refine((value) => !value.includes('\0')),
        )
        .max(64)
        .refine(
          (values) => values.reduce((length, value) => length + value.length, 0) <= 8192,
          '启动参数合计不能超过 8192 个字符',
        ),
    })
    .strict(),
]);
const identity = z
  .object({
    pid: z.number().int().positive().max(0xffffffff),
    created: z.string().regex(/^[1-9][0-9]{0,19}$/),
    image: executable,
    bits: z.union([z.literal(0), z.literal(32), z.literal(64)]),
  })
  .strict();
const managed = identity.extend({ sha256: digest }).strict();
const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    owner: z.uuid(),
    settings: nativeClipboardSettings,
    managed: z.array(managed).max(256),
  })
  .strict();
const nativeState = z
  .object({
    present: z.literal(true),
    ready: z.boolean(),
    active: z.boolean(),
    compatible: z.boolean(),
    flags: z.number().int().min(0).max(15),
    maximum: z.number().int().min(1024).max(1048576),
    blockedCopy: z.number().nonnegative(),
    blockedPaste: z.number().nonnegative(),
  })
  .strict();
const statusSchema = z.union([z.object({ present: z.literal(false) }).strict(), nativeState]);
const listSchema = z
  .object({ processes: z.array(identity.extend({ image: z.string().min(1).max(32768) }).strict()).max(8192) })
  .strict();
const assetNames = [
  'SakuraClipboardPolicy.dll',
  'sakura-clipboard-controller.exe',
  'MinHook-LICENSE.txt',
] as const;
const dualAssetNames = [
  ...assetNames,
  'SakuraClipboardPolicy-x86.dll',
  'sakura-clipboard-controller-x86.exe',
] as const;
const earlyAssetNames = [...dualAssetNames, 'Detours-LICENSE.md'] as const;
const assetsSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    architecture: z.literal('x64'),
    build: digest,
    files: z
      .array(
        z
          .object({
            name: z.enum(earlyAssetNames),
            size: z
              .number()
              .int()
              .positive()
              .max(16 * 1024 * 1024),
            sha256: digest,
          })
          .strict(),
      )
      .min(3)
      .max(6),
  })
  .strict()
  .refine((value) => {
    const expected =
      value.version === 1 ? assetNames : value.version === 2 ? dualAssetNames : earlyAssetNames;
    return (
      value.files.length === expected.length &&
      new Set(value.files.map((item) => item.name)).size === expected.length &&
      expected.every((name) => value.files.some((item) => item.name === name))
    );
  });
const flags = (value: ClipboardRule) =>
  (value.copy ? 1 : 0) | (value.paste ? 2 : 0) | (value.files ? 4 : 0) | (value.sensitive ? 8 : 0);
const key = (value: { pid: number; created: string }) => `${value.pid}:${value.created}`;
const execute = promisify(execFile);
export type NativeClipboardLaunchHooks = {
  prepared: (process: NativeClipboardProcess) => Promise<void>;
  attached: (process: NativeClipboardProcess, state: z.infer<typeof nativeState>) => Promise<void>;
};
export type NativeClipboardLaunch = (
  file: string,
  args: string[],
  hooks: NativeClipboardLaunchHooks,
  signal: AbortSignal,
) => Promise<NativeClipboardProcess>;
const launchIdentity = z
  .object({
    stage: z.enum(['prepared', 'attached', 'committed']),
    launchId: z.uuid(),
    process: identity,
    state: nativeState.optional(),
  })
  .strict();
// The helper owns a fresh kill-on-close Job atomically assigned at creation.
// Before commit, EOF, service close or a rejected handshake kills only that Job.
// A lost commit reply may leave an enforced child alive; retain its journal.
const nativeLaunch: NativeClipboardLaunch = async (file, args, hooks, signal) => {
  if (signal.aborted) throw new AppError('受控启动已取消', 503);
  const child = spawn(file, args, {
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '',
    bytes = 0,
    sequence = 0,
    processIdentity: NativeClipboardProcess | undefined;
  let failure: unknown,
    flow: Promise<void> = Promise.resolve();
  let committed!: () => void, rejected!: (reason: unknown) => void;
  const commitment = new Promise<void>((resolve, reject) => {
    committed = resolve;
    rejected = reject;
  });
  void commitment.catch(() => {});
  const stop = (error: unknown) => {
    failure ||= error;
    rejected(failure);
    child.stdin.destroy();
    child.kill();
    child.stdout.destroy();
    child.stderr.destroy();
  };
  const aborted = () => stop(new AppError('受控启动确认已中止；已保存的归属保留，请刷新进程状态', 503));
  signal.addEventListener('abort', aborted, { once: true });
  const timeout = setTimeout(
    () => stop(new AppError('受控启动确认超时；已保存的归属保留，请刷新进程状态', 503)),
    120000,
  );
  const consume = async (line: string) => {
    if (failure || signal.aborted) return;
    const value: unknown = JSON.parse(line);
    const error = z
      .object({ error: z.string().max(256), systemError: z.number() })
      .strict()
      .safeParse(value);
    if (error.success) throw new AppError(error.data.error, 503);
    const message = launchIdentity.parse(value);
    if (
      message.stage !== ['prepared', 'attached', 'committed'][sequence] ||
      message.launchId !== args[7] ||
      (message.stage === 'attached') !== !!message.state ||
      (processIdentity &&
        (key(processIdentity) !== key(message.process) ||
          samePath(processIdentity.image) !== samePath(message.process.image) ||
          processIdentity.bits !== message.process.bits))
    )
      throw new AppError('受控启动握手身份或顺序无效', 503);
    processIdentity = message.process;
    if (message.stage === 'prepared') await hooks.prepared(message.process);
    if (message.stage === 'attached') await hooks.attached(message.process, message.state!);
    if (failure || signal.aborted) return;
    sequence++;
    if (message.stage !== 'committed')
      child.stdin.write(`${message.stage === 'prepared' ? 'attach' : 'resume'} ${args[7]}\n`);
    else {
      child.stdin.end();
      committed();
    }
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 32768) {
      stop(new AppError('受控启动工具返回过多数据', 503));
      return;
    }
    output += chunk;
    let index: number;
    while ((index = output.indexOf('\n')) >= 0) {
      const line = output.slice(0, index).replace(/\r$/, '');
      output = output.slice(index + 1);
      flow = flow.then(() => consume(line)).catch(stop);
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 32768) stop(new AppError('受控启动工具返回过多数据', 503));
  });
  child.stdin.on('error', (error) => {
    if (sequence < 3) stop(error);
  });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    // Windows console lifetimes may keep a pipe open after the helper exits.
    // Success requires its explicit commit frame and zero process exit status,
    // rather than the lifetime of any inherited console resource.
    if (code === 0) await commitment;
    await flow;
    if (failure) throw failure;
    if (code !== 0 || sequence !== 3 || output.trim() || !processIdentity)
      throw new AppError('受控启动未确认；已保存的归属保留，请刷新进程状态', 503);
    return processIdentity;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', aborted);
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
};
async function nativeCommand(file: string, args: string[]): Promise<unknown> {
  try {
    const { stdout } = await execute(file, args, {
      windowsHide: true,
      timeout: 70000,
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8',
    });
    return JSON.parse(stdout);
  } catch (error) {
    const output = (error as { stdout?: string }).stdout;
    let reason = '原生剪贴板工具未完成';
    if (output) {
      try {
        reason = z
          .object({ error: z.string().max(256), systemError: z.number() })
          .parse(JSON.parse(output)).error;
      } catch {}
    }
    throw new AppError(reason, 503);
  }
}
export async function clipboardExecutableHash(path: string) {
  executable.parse(path);
  await regularDirectory(dirname(path));
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 512 * 1024 * 1024)
    throw new AppError('应用程序文件不是普通 EXE 文件');
  const value = await fileHash(path);
  const after = await lstat(path);
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
    throw new AppError('应用程序文件正在变化，请重试', 409);
  return value;
}
export async function clipboardExecutableBits(path: string): Promise<32 | 64> {
  executable.parse(path);
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(64),
      pe = Buffer.alloc(26);
    if (
      (await file.read(header, 0, header.length, 0)).bytesRead !== header.length ||
      header.readUInt16LE(0) !== 0x5a4d
    )
      throw new AppError('所选文件不是 Windows EXE');
    const offset = header.readUInt32LE(60);
    if (
      offset < 64 ||
      offset > 1048576 ||
      (await file.read(pe, 0, pe.length, offset)).bytesRead !== pe.length ||
      pe.readUInt32LE(0) !== 0x4550 ||
      !(pe.readUInt16LE(22) & 2) ||
      pe.readUInt16LE(22) & 0x2000
    )
      throw new AppError('所选文件不是 Windows EXE');
    if (pe.readUInt16LE(4) === 0x14c && pe.readUInt16LE(24) === 0x10b) return 32;
    if (pe.readUInt16LE(4) === 0x8664 && pe.readUInt16LE(24) === 0x20b) return 64;
    throw new AppError('受控启动仅支持 x64 或 x86 EXE');
  } finally {
    await file.close();
  }
}
type Options = {
  file?: string;
  assets?: string;
  supported?: boolean;
  pid?: number;
  interval?: number;
  run?: (file: string, args: string[]) => Promise<unknown>;
  hashImage?: (path: string) => Promise<string>;
  imageBits?: (path: string) => Promise<32 | 64>;
  launch?: NativeClipboardLaunch;
  guard?: () => void;
  maintenance?: () => boolean;
  mutation?: (delta: number) => void;
};

// Only explicitly selected, same-user/session processes are attached. The DLL
// retains its current policy if this service closes; shutdown never relaxes it.
export class NativeClipboard {
  private hasX86 = false;
  private hasEarly = false;
  private state: z.infer<typeof stateSchema> = {
    schemaVersion: 1,
    version: 1,
    owner: randomUUID(),
    settings: { enabled: false, applications: [] },
    managed: [],
  };
  private inventory: NativeClipboardProcess[] = [];
  private processes: NativeClipboardProcessState[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private readonly lifetime = new AbortController();
  private scanning = false;
  private ready = false;
  private error?: string;
  private lastScan?: string;
  private failed = new Map<string, number>();
  private readonly file: string;
  private readonly assets: string;
  private readonly supported: boolean;
  private readonly pid: number;
  private readonly run: NonNullable<Options['run']>;
  private readonly hashImage: NonNullable<Options['hashImage']>;
  private readonly imageBits: NonNullable<Options['imageBits']>;
  private readonly start: NativeClipboardLaunch;
  constructor(private options: Options = {}) {
    this.file = options.file || join(DATA, 'native-clipboard.json');
    this.assets = options.assets || join(ROOT, '.sakura-server', 'assets', 'native-clipboard');
    this.supported = options.supported ?? (process.platform === 'win32' && process.arch === 'x64');
    this.pid = options.pid ?? process.pid;
    this.run = options.run || nativeCommand;
    this.hashImage = options.hashImage || clipboardExecutableHash;
    this.imageBits = options.imageBits || clipboardExecutableBits;
    this.start = options.launch || nativeLaunch;
  }
  async init() {
    this.state = stateSchema.parse(await readStore(this.file, () => this.state));
    await this.serial(() => this.scan());
    const interval = this.options.interval ?? 4000;
    if (interval > 0) {
      this.timer = setInterval(() => {
        if (this.closed || this.scanning || (!this.state.settings.enabled && !this.state.managed.length))
          return;
        this.scanning = true;
        void this.serial(() => this.scan())
          .catch((error) => {
            this.error = (error as Error).message;
          })
          .finally(() => {
            this.scanning = false;
          });
      }, interval);
      this.timer.unref();
    }
  }
  view(): NativeClipboardView {
    return structuredClone({
      version: this.state.version,
      supported: this.supported,
      ready: this.ready,
      settings: this.state.settings,
      available: this.inventory,
      processes: this.processes,
      lastScan: this.lastScan,
      error: this.error,
    });
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new AppError('剪贴板代理正在关闭', 503);
        return work();
      });
    this.queue = task;
    return task;
  }
  private controller(bits = 64) {
    return join(this.assets, `sakura-clipboard-controller${bits === 32 ? '-x86' : ''}.exe`);
  }
  private library(bits = 64) {
    return join(this.assets, `SakuraClipboardPolicy${bits === 32 ? '-x86' : ''}.dll`);
  }
  private async checkedAssets(library: boolean) {
    if (!this.supported) throw new AppError('当前宿主机需要 Windows x64 才能使用此代理', 503);
    await regularDirectory(this.assets);
    const manifestPath = join(this.assets, 'native-clipboard.json');
    const info = await lstat(manifestPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16384)
      throw new AppError('原生剪贴板清单无效', 503);
    const manifest = assetsSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
    for (const name of library
      ? manifest.version === 1
        ? assetNames
        : manifest.version === 2
          ? dualAssetNames
          : earlyAssetNames
      : (['sakura-clipboard-controller.exe'] as const)) {
      const file = join(this.assets, name),
        item = manifest.files.find((item) => item.name === name)!;
      const info = await lstat(file);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size !== item.size ||
        (await fileHash(file)) !== item.sha256
      )
        throw new AppError(`原生剪贴板文件完整性失败：${name}`, 503);
    }
    this.hasX86 = manifest.version >= 2;
    this.hasEarly = manifest.version >= 3;
  }
  private async list() {
    return listSchema
      .parse(await this.run(this.controller(), ['list']))
      .processes.filter((item) => item.pid !== this.pid && executable.safeParse(item.image).success);
  }
  private status(item: NativeClipboardProcess) {
    return this.run(this.controller(), ['status', this.state.owner, String(item.pid), item.created]).then(
      (value) => statusSchema.parse(value),
    );
  }
  private apply(item: NativeClipboardProcess, rule: ClipboardRule, active: boolean) {
    const bits = active ? item.bits : 64;
    if (active && bits === 32 && !this.hasX86)
      throw new AppError('此运行包未包含 32 位应用代理，请更新运行包');
    return this.run(this.controller(bits), [
      'apply',
      this.state.owner,
      String(item.pid),
      item.created,
      item.image,
      this.library(bits),
      String(flags(rule)),
      String(rule.maxTextBytes),
      active ? '1' : '0',
    ]).then((value) => nativeState.parse(value));
  }
  private async saveManaged(value: z.infer<typeof managed>[]) {
    const next = { ...this.state, managed: value };
    await writeStore(this.file, next);
    this.state = next;
  }
  private async scan() {
    if (this.options.maintenance?.()) {
      this.error = '数据目录迁移维护中；已加载的进程策略继续生效';
      return;
    }
    this.options.mutation?.(1);
    try {
      await this.reconcile();
    } finally {
      this.options.mutation?.(-1);
    }
  }
  private async reconcile() {
    this.error = undefined;
    this.ready = false;
    let libraryError: string | undefined;
    try {
      await this.checkedAssets(false);
      this.inventory = await this.list();
      try {
        await this.checkedAssets(true);
        this.ready = true;
      } catch (error) {
        libraryError = (error as Error).message;
        this.error = libraryError;
      }
    } catch (error) {
      this.error = this.supported
        ? `原生剪贴板代理不可用：${(error as Error).message}`
        : '当前宿主机需要 Windows x64 才能使用此代理';
      this.inventory = [];
      this.processes = this.state.managed.map((item) => ({
        ...item,
        state: 'error',
        error: this.error,
        blockedCopy: 0,
        blockedPaste: 0,
      }));
      return;
    }
    const selected = new Map(this.state.settings.applications.map((item) => [samePath(item.image), item]));
    const states: NativeClipboardProcessState[] = [];
    const hashes = new Map<string, Promise<string>>();
    const check = (image: string) => {
      const path = samePath(image);
      if (!hashes.has(path)) hashes.set(path, this.hashImage(image));
      return hashes.get(path)!;
    };
    // A missing process-list entry is not proof of exit. A live DLL owns its
    // policy mapping, so retain the journal until that mapping is gone/disabled.
    const known = new Map<string, NativeClipboardProcess>(
      this.state.managed.map((item) => [key(item), item]),
    );
    for (const item of this.inventory)
      if (this.state.settings.enabled && selected.has(samePath(item.image))) known.set(key(item), item);
    for (const item of known.values()) {
      let observed: z.infer<typeof statusSchema> = { present: false };
      try {
        const desired = this.state.settings.enabled ? selected.get(samePath(item.image)) : undefined;
        observed = await this.status(item);
        if (!desired) {
          if (observed.present && observed.active) {
            observed = await this.apply(
              item,
              { copy: true, paste: true, files: true, sensitive: false, maxTextBytes: 1048576 },
              false,
            );
            if (observed.active) throw new AppError('进程策略尚未停用');
          }
          if (this.state.managed.some((entry) => key(entry) === key(item))) {
            await this.saveManaged(this.state.managed.filter((entry) => key(entry) !== key(item)));
          }
          states.push({
            ...item,
            state: 'disabled',
            blockedCopy: observed.present ? observed.blockedCopy : 0,
            blockedPaste: observed.present ? observed.blockedPaste : 0,
          });
          continue;
        }
        if (!this.inventory.some((entry) => key(entry) === key(item))) {
          if (!observed.present) {
            await this.saveManaged(this.state.managed.filter((entry) => key(entry) !== key(item)));
            continue;
          }
          throw new AppError('进程仍保留策略，但当前无法核对身份');
        }
        if (item.bits !== 64 && (item.bits !== 32 || !this.hasX86))
          throw new AppError('此进程架构不受支持；需要运行包对应的 x64 或 x86 应用');
        if ((await check(item.image)) !== desired.sha256)
          throw new AppError('应用文件已变化，请重新选择应用并保存规则');
        if (libraryError) throw new AppError(libraryError);
        if (
          !observed.present ||
          !observed.ready ||
          !observed.active ||
          observed.flags !== flags(desired.rule) ||
          observed.maximum !== desired.rule.maxTextBytes
        ) {
          if ((this.failed.get(key(item)) || 0) > Date.now())
            throw new AppError('等待重试原生附加；可刷新立即重试');
          if (!this.state.managed.some((entry) => key(entry) === key(item))) {
            if (this.state.managed.length >= 256) throw new AppError('受管进程已达到 256 个上限');
            // Persist ownership before attaching, including failed/pending calls.
            await this.saveManaged([...this.state.managed, { ...item, sha256: desired.sha256 }]);
          }
          observed = await this.apply(item, desired.rule, true);
        }
        if (
          !observed.present ||
          !observed.ready ||
          !observed.active ||
          !observed.compatible ||
          observed.flags !== flags(desired.rule) ||
          observed.maximum !== desired.rule.maxTextBytes
        )
          throw new AppError('进程代理与当前版本不一致，请重新启动该应用');
        this.failed.delete(key(item));
        states.push({
          ...item,
          state: 'enforced',
          blockedCopy: observed.blockedCopy,
          blockedPaste: observed.blockedPaste,
        });
      } catch (error) {
        this.failed.set(key(item), Date.now() + 30000);
        states.push({
          ...item,
          state: 'error',
          error: (error as Error).message,
          blockedCopy: observed.present ? observed.blockedCopy : 0,
          blockedPaste: observed.present ? observed.blockedPaste : 0,
        });
      }
    }
    this.processes = states;
    this.lastScan = new Date().toISOString();
    for (const id of this.failed.keys()) if (!known.has(id)) this.failed.delete(id);
  }
  private async controlledLaunch(
    input: Extract<z.infer<typeof nativeClipboardRequest>, { action: 'launch' }>,
  ) {
    const allowed = () => {
      if (this.closed || this.lifetime.signal.aborted) throw new AppError('剪贴板代理正在关闭', 503);
      this.options.guard?.();
      if (this.options.maintenance?.()) throw new AppError('数据目录迁移维护中', 409);
      if (input.version !== this.state.version) throw new AppError('剪贴板配置已改变，请刷新后重试', 409);
      const selected = this.state.settings.applications.find(
        (entry) => samePath(entry.image) === samePath(input.image),
      );
      if (!this.state.settings.enabled || !selected || selected.sha256 !== input.sha256)
        throw new AppError('受控启动需要已保存并启用的应用规则', 409);
      return selected;
    };
    const selected = allowed();
    if (this.state.managed.length >= 256) throw new AppError('受管进程已达到 256 个上限');
    await this.checkedAssets(true);
    if ((await this.hashImage(selected.image)) !== selected.sha256)
      throw new AppError('应用文件摘要已变化，请重新选择', 409);
    const bits = await this.imageBits(selected.image);
    if (bits === 32 && !this.hasX86) throw new AppError('此运行包未包含 32 位应用代理，请更新运行包');
    if (!this.hasEarly) throw new AppError('此运行包未包含应用 DLL/TLS 初始化前的策略代理，请更新运行包');
    allowed();
    const sameIdentity = (value: NativeClipboardProcess) => {
      const item = identity.parse(value);
      if (samePath(item.image) !== samePath(selected.image) || item.bits !== bits || item.pid === this.pid)
        throw new AppError('受控启动进程身份与已保存应用不一致', 503);
      return item;
    };
    let owned: NativeClipboardProcess | undefined, loaded: z.infer<typeof nativeState> | undefined;
    try {
      const process = await this.start(
        this.controller(bits),
        [
          'launch',
          this.state.owner,
          win32.normalize(selected.image),
          selected.sha256,
          this.library(bits),
          String(flags(selected.rule)),
          String(selected.rule.maxTextBytes),
          randomUUID(),
          ...input.args,
        ],
        {
          prepared: async (value) => {
            allowed();
            const item = sameIdentity(value);
            if (
              this.state.managed.some((entry) => key(entry) === key(item)) ||
              this.inventory.some((entry) => key(entry) === key(item))
            )
              throw new AppError('受控启动返回了已有进程；拒绝复用其归属', 503);
            // The helper waits with a suspended primary thread and a kill-on-close
            // Job until this journal is durably saved, before loading any policy.
            await this.saveManaged([...this.state.managed, { ...item, sha256: selected.sha256 }]);
            owned = item;
            allowed();
          },
          attached: async (value, state) => {
            allowed();
            const item = sameIdentity(value);
            if (
              !owned ||
              key(owned) !== key(item) ||
              !this.state.managed.some(
                (entry) => key(entry) === key(item) && entry.sha256 === selected.sha256,
              )
            )
              throw new AppError('受控启动缺少已保存的进程归属', 503);
            const coherent = (value: z.infer<typeof statusSchema>) =>
              value.present &&
              value.ready &&
              value.active &&
              value.compatible &&
              value.flags === flags(selected.rule) &&
              value.maximum === selected.rule.maxTextBytes;
            if (!coherent(nativeState.parse(state))) throw new AppError('受控启动策略未加载完成', 503);
            const observed = await this.status(item);
            if (!coherent(observed)) throw new AppError('受控启动策略复核失败', 503);
            await this.checkedAssets(true);
            if ((await this.hashImage(selected.image)) !== selected.sha256)
              throw new AppError('应用文件摘要已变化，请重新选择', 409);
            allowed();
            loaded = nativeState.parse(observed);
          },
        },
        this.lifetime.signal,
      );
      const item = sameIdentity(process);
      if (!owned || key(owned) !== key(item) || !loaded)
        throw new AppError('受控启动未返回已核对的提交身份', 503);
      this.inventory = [...this.inventory.filter((entry) => key(entry) !== key(item)), item];
      this.processes = [
        ...this.processes.filter((entry) => key(entry) !== key(item)),
        {
          ...item,
          state: 'enforced',
          blockedCopy: loaded.blockedCopy,
          blockedPaste: loaded.blockedPaste,
        },
      ];
      this.error = undefined;
      this.ready = true;
      this.lastScan = new Date().toISOString();
      return { process: item, view: this.view() };
    } catch (error) {
      if (owned) {
        this.processes = [
          ...this.processes.filter((entry) => key(entry) !== key(owned!)),
          {
            ...owned,
            state: 'error',
            error: (error as Error).message,
            blockedCopy: loaded?.blockedCopy || 0,
            blockedPaste: loaded?.blockedPaste || 0,
          },
        ];
      }
      throw error;
    }
  }
  action(value: unknown) {
    const input = nativeClipboardRequest.parse(value);
    return this.serial(async () => {
      this.options.guard?.();
      if (this.options.maintenance?.()) throw new AppError('数据目录迁移维护中', 409);
      this.options.mutation?.(1);
      try {
        if (input.action === 'launch') return await this.controlledLaunch(input);
        if (input.action === 'identify') {
          await this.checkedAssets(false);
          const item = (await this.list()).find(
            (item) => item.pid === input.pid && item.created === input.created,
          );
          if (!item) throw new AppError('进程身份已变化，请刷新应用列表', 409);
          if (item.bits !== 64 && (item.bits !== 32 || !this.hasX86))
            throw new AppError('此进程架构不受支持；需要运行包对应的 x64 或 x86 应用');
          const sha256 = await this.hashImage(item.image);
          const again = (await this.list()).find((entry) => key(entry) === key(item));
          if (!again || samePath(again.image) !== samePath(item.image))
            throw new AppError('进程身份已变化，请刷新应用列表', 409);
          return { image: item.image, sha256 };
        }
        if (input.action === 'configure') {
          if (input.version !== this.state.version) throw new AppError('剪贴板配置已改变，请刷新后重试', 409);
          if (input.settings.enabled) await this.checkedAssets(true);
          if (input.settings.enabled)
            for (const item of input.settings.applications)
              if ((await this.hashImage(item.image)) !== item.sha256)
                throw new AppError('应用文件摘要已变化，请重新选择', 409);
          this.options.guard?.();
          const next = { ...this.state, version: this.state.version + 1, settings: input.settings };
          await writeStore(this.file, next);
          this.state = next;
        }
        this.failed.clear();
        await this.reconcile();
        return this.view();
      } finally {
        this.options.mutation?.(-1);
      }
    });
  }
  async close() {
    this.closed = true;
    this.lifetime.abort();
    if (this.timer) clearInterval(this.timer);
    await this.queue.catch(() => {});
  }
}
