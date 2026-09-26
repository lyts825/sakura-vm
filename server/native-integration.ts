import { lstat, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, DATA, PORT, ROOT } from './model.ts';
import { readStore, regularDirectory, within, writeStore } from './local-store.ts';
import {
  launchNative,
  systemExecutable,
  windowsRegistry,
  type RegistryApply,
  type RegistryEntry,
} from './windows-shell.ts';
import type {
  NativeHandoff,
  NativeMapping,
  NativeSettings,
  NativeView,
} from '../shared/native-integration.ts';
import type { Features } from './features.ts';

const project = z.string().regex(/^(default|[a-f0-9]{16})$/);
const extension = z.string().regex(/^\.[a-z0-9][a-z0-9_-]{0,23}$/);
const scope = { vmId: z.uuid(), projectId: project };
export const nativeSettings = z
  .object({
    contextMenu: z.boolean(),
    editor: z.enum(['notepad', 'vscode']),
    associations: z.array(z.object({ extension, ...scope }).strict()).max(32),
  })
  .strict()
  .refine(
    (v) => new Set(v.associations.map((e) => e.extension)).size === v.associations.length,
    '扩展名不能重复',
  );
const safePath = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\x00-\x1f]+$/);
export const nativeRequest = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('configure'),
      version: z.number().int().positive(),
      settings: nativeSettings,
    })
    .strict(),
  z.object({ action: z.literal('repair'), version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('receive'), path: safePath, extension: extension.optional() }).strict(),
  z.object({ action: z.literal('resolve'), ticket: z.uuid() }).strict(),
  z
    .object({ action: z.literal('open'), ...scope, path: safePath, target: z.enum(['explorer', 'editor']) })
    .strict(),
]);
const entry = z
  .object({ path: z.string().max(1024), name: z.string().max(128), value: z.string().max(16384) })
  .strict();
const stateSchema = z
  .object({
    version: z.number().int().positive(),
    owner: z.string().regex(/^[a-f0-9]{16}$/),
    settings: nativeSettings,
    registered: z.array(entry).max(500),
    pending: z
      .object({ settings: nativeSettings, entries: z.array(entry).max(500) })
      .strict()
      .optional(),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
const defaults = (): NativeSettings => ({ contextMenu: false, editor: 'notepad', associations: [] });

export async function nativeMappings(features: Features): Promise<NativeMapping[]> {
  if (!features.sync || !features.workspaces || !features.enabled.has('files')) return [];
  const result: NativeMapping[] = [];
  for (const vm of features.machines.records.values()) {
    // Incident isolation also blocks host-side access to the workspace.
    if (vm.sandbox || features.machines.incidentLocked(vm.id)) continue;
    const index = await features.workspaces.projects.list(vm.id);
    for (const p of index.projects) {
      const config = await features.workspaces.projects.inScope(vm.id, p.id, () =>
        features.sync.config(vm.id),
      );
      if (config)
        result.push({
          vmId: vm.id,
          projectId: p.id,
          name: `${vm.name} / ${p.name}`,
          host: config.host,
          guest: config.guest,
        });
    }
  }
  return result;
}

// Shell substitutes %1 / %V after parsing this template. Windows paths cannot
// contain quotes; literal percent signs in install paths would create placeholders.
function commandPart(value: string) {
  if (!win32.isAbsolute(value) || /["%\x00-\x1f]/.test(value) || value.endsWith('\\'))
    throw new AppError('Windows 集成安装路径不能包含引号、百分号或控制字符');
  return `"${value}"`;
}
export function nativeRegistration(
  owner: string,
  settings: NativeSettings,
  node: string,
  helper: string,
  port: number,
): RegistryEntry[] {
  const result: RegistryEntry[] = [];
  const progId = `Sakura.Workspace.${owner}`;
  const base = `${commandPart(node)} ${commandPart(helper)} --port ${port}`;
  const put = (path: string, value: string, name = '') => result.push({ path, name, value });
  if (settings.contextMenu) {
    for (const [parent, parameter] of [
      ['Directory', '%1'],
      ['Directory\\Background', '%V'],
      ['*', '%1'],
    ]) {
      const key = `${parent}\\shell\\${progId}`;
      put(key, '在 Sakura 工作区中打开');
      put(key, 'Single', 'MultiSelectModel');
      // A sentinel after the path preserves a directory's trailing backslash
      // through Windows command-line quote parsing. The helper removes it.
      put(key + '\\command', `${base} --shell-path "${parameter}|"`);
    }
  }
  for (const association of settings.associations) {
    const id = `${progId}.${association.extension.slice(1)}`;
    put(id, `Sakura 工作区 (${association.extension})`);
    put(id + '\\shell', 'open');
    put(id + '\\shell\\open', '在 Sakura 工作区中打开');
    put(id + '\\shell\\open\\command', `${base} --extension ${association.extension} --shell-path "%1|"`);
    put(association.extension + '\\OpenWithProgids', '', id);
  }
  return result;
}

export async function checkedHostPath(root: string, target: string) {
  if (!isAbsolute(root) || !isAbsolute(target) || !within(root, target))
    throw new AppError('文件不在此项目的 Windows 同步目录中', 403);
  for (const path of [root, target]) {
    // Refuse device/UNC namespaces, ADS, ambiguous suffixes and symlink/junction
    // traversal. Checking every ancestor also protects a renamed root.
    if (process.platform === 'win32' && (!/^[a-z]:[\\/]/i.test(path) || path.slice(2).includes(':')))
      throw new AppError('仅支持本机驱动器中的普通路径');
    if (
      /[\x00-\x1f]/.test(path) ||
      path
        .split(/[\\/]/)
        .some((p) => /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))
    )
      throw new AppError('路径包含不支持的 Windows 文件名');
  }
  await regularDirectory(root);
  await regularDirectory(dirname(target));
  const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new AppError('Windows 文件尚不存在，请先同步项目', 404);
    throw error;
  });
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || (info.isFile() && info.nlink > 1))
    throw new AppError('不能打开链接或特殊文件', 403);
  const actualRoot = await realpath(root),
    actual = await realpath(target);
  if (!within(actualRoot, actual)) throw new AppError('文件已离开 Windows 同步目录', 403);
  return { path: actual, directory: info.isDirectory() };
}

export class NativeIntegration {
  private state: State = {
    version: 1,
    owner: randomBytes(8).toString('hex'),
    settings: defaults(),
    registered: [],
  };
  private busy = false;
  private closed = false;
  private pending = new Set<Promise<unknown>>();
  private epoch = 0;
  private tickets = new Map<string, { value: NativeHandoff; mapping: string; expires: number }>();
  constructor(
    private mappings: () => Promise<NativeMapping[]>,
    private file = join(DATA, 'native-integration.json'),
    private registry: RegistryApply = windowsRegistry(),
    private launch = launchNative,
    private runtime = {
      supported: process.platform === 'win32',
      node: process.execPath,
      helper: join(ROOT, 'scripts', 'native-open.mjs'),
      port: PORT,
    },
    private guard: (vmId?: string) => void = () => {},
    private now = Date.now,
  ) {}
  async init() {
    this.state = stateSchema.parse(await readStore(this.file, () => this.state));
  }
  async view(): Promise<NativeView> {
    return {
      supported: this.runtime.supported,
      version: this.state.version,
      settings: structuredClone(this.state.settings),
      pending: !!this.state.pending,
      mappings: await this.mappings(),
    };
  }
  revoke() {
    this.epoch++;
    this.tickets.clear();
  }
  async close() {
    this.closed = true;
    this.revoke();
    await Promise.allSettled(this.pending);
  }
  private check(epoch = this.epoch, vmId?: string) {
    this.guard(vmId);
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (epoch !== this.epoch) throw new AppError('操作会话已失效，请重新打开', 409);
    if (!this.runtime.supported) throw new AppError('宿主机集成仅支持 Windows', 409);
  }
  async action(input: unknown) {
    const task = this.perform(input);
    this.pending.add(task);
    try {
      return await task;
    } finally {
      this.pending.delete(task);
    }
  }
  private async perform(input: unknown) {
    const request = nativeRequest.parse(input),
      epoch = this.epoch;
    this.check(epoch);
    if (request.action === 'configure' || request.action === 'repair') {
      if (this.busy) throw new AppError('Windows 集成配置正在更新', 409);
      if (request.version !== this.state.version) throw new AppError('设置已改变，请刷新后重试', 409);
      this.busy = true;
      try {
        if (request.action === 'configure') {
          if (this.state.pending) throw new AppError('上次注册尚未完成，请先修复', 409);
          const mappings = await this.mappings();
          for (const a of request.settings.associations)
            if (!mappings.some((m) => m.vmId === a.vmId && m.projectId === a.projectId))
              throw new AppError('关联的项目尚未配置 Windows 同步目录', 409);
          const entries = nativeRegistration(
            this.state.owner,
            request.settings,
            this.runtime.node,
            this.runtime.helper,
            this.runtime.port,
          );
          if (entries.length) {
            if (!(await lstat(this.runtime.helper)).isFile())
              throw new AppError('Windows 打开助手未安装', 503);
          }
          this.check(epoch);
          const journal = {
            ...this.state,
            version: this.state.version + 1,
            pending: { settings: request.settings, entries },
          };
          await writeStore(this.file, journal);
          this.state = journal;
        }
        this.check(epoch);
        if (this.state.pending) {
          await this.registry(this.state.registered, this.state.pending.entries);
          // Keep the write-ahead journal if committing fails; repair is idempotent.
          const committed = {
            ...this.state,
            settings: this.state.pending.settings,
            registered: this.state.pending.entries,
            pending: undefined,
          };
          await writeStore(this.file, committed);
          this.state = committed;
          this.revoke();
        }
        return this.view();
      } finally {
        this.busy = false;
      }
    }
    if (this.state.pending || this.busy) throw new AppError('请等待或修复 Windows 集成设置', 409);
    const mappings = await this.mappings();
    this.check(epoch);
    if (request.action === 'resolve') {
      const ticket = this.tickets.get(request.ticket);
      if (!ticket || ticket.expires <= this.now())
        throw new AppError('打开请求已过期，请从资源管理器重新打开', 410);
      const mapping = mappings.find(
        (m) => m.vmId === ticket.value.vmId && m.projectId === ticket.value.projectId,
      );
      if (!mapping || JSON.stringify(mapping) !== ticket.mapping)
        throw new AppError('项目同步目录已改变，请重新打开', 409);
      this.check(epoch, mapping.vmId);
      return structuredClone(ticket.value);
    }
    if (request.action === 'receive') {
      if (
        request.extension
          ? !this.state.settings.associations.some((a) => a.extension === request.extension)
          : !this.state.settings.contextMenu
      )
        throw new AppError('此 Windows 打开入口未启用', 403);
      if (!isAbsolute(request.path)) throw new AppError('需要本机文件的绝对路径');
      const path = resolve(request.path);
      const association = this.state.settings.associations.find((a) => a.extension === request.extension);
      let candidates = mappings.filter(
        (m) =>
          within(m.host, path) &&
          (!association || (m.vmId === association.vmId && m.projectId === association.projectId)),
      );
      if (!candidates.length)
        throw new AppError('此文件不在已配置的 Windows 同步目录中，请先在项目的目录同步页配置', 404);
      candidates = candidates.sort((a, b) => b.host.length - a.host.length);
      const mapping = candidates[0];
      if (
        candidates.length > 1 &&
        resolve(candidates[1].host).toLowerCase() === resolve(mapping.host).toLowerCase()
      )
        throw new AppError('此 Windows 目录关联了多个项目，请通过扩展名关联选择项目', 409);
      const checked = await checkedHostPath(mapping.host, path);
      if (request.extension && (checked.directory || extname(path).toLowerCase() !== request.extension))
        throw new AppError('文件类型与关联不符');
      this.check(epoch, mapping.vmId);
      for (const [id, ticket] of this.tickets) if (ticket.expires <= this.now()) this.tickets.delete(id);
      if (this.tickets.size >= 64) throw new AppError('打开请求过多，请稍后再试', 429);
      const value: NativeHandoff = {
        vmId: mapping.vmId,
        projectId: mapping.projectId,
        path: posix.join(mapping.guest, relative(mapping.host, checked.path).split(sep).join('/')),
        directory: checked.directory,
      };
      const ticket = randomUUID();
      this.tickets.set(ticket, { value, mapping: JSON.stringify(mapping), expires: this.now() + 300000 });
      return { ticket, url: `http://127.0.0.1:${this.runtime.port}/#native=${ticket}` };
    }
    const mapping = mappings.find((m) => m.vmId === request.vmId && m.projectId === request.projectId);
    if (!mapping) throw new AppError('请先配置此项目的 Windows 目录同步', 409);
    const guest = posix.normalize(request.path),
      suffix = posix.relative(mapping.guest, guest);
    if (
      !request.path.startsWith('/') ||
      suffix === '..' ||
      suffix.startsWith('../') ||
      posix.isAbsolute(suffix) ||
      /[\\<>:"|?*]/.test(suffix)
    )
      throw new AppError('文件不在此项目的 Linux 同步目录中', 403);
    const checked = await checkedHostPath(mapping.host, resolve(mapping.host, ...suffix.split('/')));
    let executable: string, args: string[];
    if (request.target === 'explorer') {
      executable = systemExecutable('explorer.exe');
      args = checked.directory ? [checked.path] : ['/select,', checked.path];
    } else if (this.state.settings.editor === 'notepad') {
      if (checked.directory) throw new AppError('记事本只能打开文件；目录请使用资源管理器或 VS Code');
      executable = systemExecutable('notepad.exe');
      args = [checked.path];
    } else {
      const installations = [
        process.env.LOCALAPPDATA &&
          join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
        process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
      ].filter((p): p is string => !!p);
      executable = '';
      for (const file of installations)
        if ((await lstat(file).catch(() => null))?.isFile()) {
          executable = file;
          break;
        }
      if (!executable) throw new AppError('未找到 VS Code 的用户或系统安装，请安装后重试', 409);
      args = ['--reuse-window', '--', checked.path];
    }
    this.check(epoch, mapping.vmId);
    await this.launch(executable, args);
    return { opened: true, target: request.target, path: checked.path };
  }
}
