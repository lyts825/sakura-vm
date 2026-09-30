import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
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
const assetsSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    architecture: z.literal('x64'),
    build: digest,
    files: z
      .array(
        z
          .object({
            name: z.enum(dualAssetNames),
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
      .max(5),
  })
  .strict()
  .refine((value) => {
    const expected = value.version === 1 ? assetNames : dualAssetNames;
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
type Options = {
  file?: string;
  assets?: string;
  supported?: boolean;
  pid?: number;
  interval?: number;
  run?: (file: string, args: string[]) => Promise<unknown>;
  hashImage?: (path: string) => Promise<string>;
  guard?: () => void;
  maintenance?: () => boolean;
  mutation?: (delta: number) => void;
};

// Only explicitly selected, same-user/session processes are attached. The DLL
// retains its current policy if this service closes; shutdown never relaxes it.
export class NativeClipboard {
  private hasX86 = false;
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
  constructor(private options: Options = {}) {
    this.file = options.file || join(DATA, 'native-clipboard.json');
    this.assets = options.assets || join(ROOT, '.sakura-server', 'assets', 'native-clipboard');
    this.supported = options.supported ?? (process.platform === 'win32' && process.arch === 'x64');
    this.pid = options.pid ?? process.pid;
    this.run = options.run || nativeCommand;
    this.hashImage = options.hashImage || clipboardExecutableHash;
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
        : dualAssetNames
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
    this.hasX86 = manifest.version === 2;
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
  action(value: unknown) {
    const input = nativeClipboardRequest.parse(value);
    return this.serial(async () => {
      this.options.guard?.();
      if (this.options.maintenance?.()) throw new AppError('数据目录迁移维护中', 409);
      this.options.mutation?.(1);
      try {
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
    if (this.timer) clearInterval(this.timer);
    await this.queue.catch(() => {});
  }
}
