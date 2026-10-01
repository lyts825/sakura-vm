import { createHash, randomUUID } from 'node:crypto';
import { join, posix } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AppError, guestPath, vmDir } from './model.ts';
import type { Machines } from './machines.ts';
import type { Project } from './workspaces.ts';
import { readStore, writeStore } from './local-store.ts';
import { quote } from './files.ts';
import { guestTask } from './guest-task.ts';
import { Jobs } from './jobs.ts';
import { projectNetworkCheckScript, projectNetworkNamespace } from './project-network-isolation.ts';
import { x11SourceBundle } from './x11-clipboard-assets.ts';
import { waylandSourceBundle } from './wayland-clipboard-assets.ts';
import { defaultClipboardRule } from '../shared/clipboard-policy.ts';
import type { X11ClipboardView } from '../shared/x11-clipboard.ts';

const image = z
  .string()
  .min(2)
  .max(1024)
  .refine((value) => {
    try {
      return (
        guestPath(value) === value &&
        value === posix.normalize(value) &&
        !value.endsWith('/') &&
        !/[\x00-\x1f]/.test(value)
      );
    } catch {
      return false;
    }
  }, '需要规范的 Linux 应用完整路径');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const x11ClipboardRule = z
  .object({
    copy: z.boolean(),
    paste: z.boolean(),
    files: z.boolean(),
    sensitive: z.boolean(),
    maxTextBytes: z.number().int().min(1024).max(1048576),
  })
  .strict();
export const x11ClipboardApplication = z.object({ image, sha256: digest, rule: x11ClipboardRule }).strict();
export const x11ClipboardConfiguration = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    owner: z.uuid(),
    applications: z.array(x11ClipboardApplication).max(32),
  })
  .strict()
  .refine((value) => new Set(value.applications.map((app) => app.image)).size === value.applications.length);
export const x11ClipboardRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('install') }).strict(),
  z.object({ action: z.literal('identify'), image }).strict(),
  z
    .object({
      action: z.literal('save'),
      version: z.number().int().positive(),
      application: x11ClipboardApplication,
    })
    .strict(),
  z.object({ action: z.literal('remove'), version: z.number().int().positive(), image }).strict(),
  z
    .object({
      action: z.literal('launch'),
      version: z.number().int().positive(),
      image,
      args: z
        .array(
          z
            .string()
            .max(1024)
            .refine((value) => !/[\x00-\x1f]/.test(value)),
        )
        .max(32)
        .default([]),
    })
    .strict(),
  z.object({ action: z.literal('stop'), id: z.uuid() }).strict(),
  z.object({ action: z.literal('forget'), id: z.uuid() }).strict(),
  z.object({ action: z.literal('refresh') }).strict(),
]);
const session = z
  .object({
    id: z.uuid(),
    state: z.enum(['running', 'stopped', 'error']),
    image: image.optional(),
    sha256: digest.optional(),
    projectId: z.string().optional(),
    directory: z.string().optional(),
    startedAt: z.string().optional(),
    compatible: z.boolean().optional(),
    active: z.boolean().optional(),
    generation: z.number().int().positive().optional(),
    rule: x11ClipboardRule.optional(),
    blockedCopy: z.number().nonnegative().optional(),
    blockedPaste: z.number().nonnegative().optional(),
    error: z.string().max(256).optional(),
    processes: z
      .array(
        z
          .object({
            pid: z.number().int().positive(),
            created: z.string().regex(/^[0-9]+$/),
            image: z.string().max(4096),
            loaded: z.boolean(),
          })
          .strict(),
      )
      .max(1024)
      .optional(),
  })
  .strict();
const inventory = z
  .object({
    ready: z.boolean(),
    build: digest,
    sessions: z.array(session).max(128),
    error: z.string().max(256).optional(),
  })
  .strict();
const job = z
  .object({
    status: z.enum(['running', 'done', 'error', 'cancelled', 'interrupted']),
    log: z.string(),
    startedAt: z.string(),
  })
  .passthrough();
export const x11ClipboardViewSchema = z
  .object({
    version: z.number().int().positive(),
    applications: z.array(x11ClipboardApplication).max(32),
    ready: z.boolean(),
    build: digest.optional(),
    sessions: z.array(session).max(128),
    error: z.string().optional(),
    installation: job.nullable(),
  })
  .strict();
export const x11ClipboardActionResponse = z.union([
  x11ClipboardViewSchema,
  session,
  job,
  z.object({ image, sha256: digest }).strict(),
  z.object({ stopped: z.literal(true) }).strict(),
  z.object({ removed: z.literal(true) }).strict(),
]);
const matches = (a: z.infer<typeof x11ClipboardRule>, b: z.infer<typeof x11ClipboardRule>) =>
  a.copy === b.copy &&
  a.paste === b.paste &&
  a.files === b.files &&
  a.sensitive === b.sensitive &&
  a.maxTextBytes === b.maxTextBytes;
type State = z.infer<typeof x11ClipboardConfiguration>;
type Bundle = Awaited<ReturnType<typeof x11SourceBundle>> | Awaited<ReturnType<typeof waylandSourceBundle>>;
export type X11ApplicationContext = { project: Project; launcherSha256: string };
export type LinuxClipboardOptions = { assets?: string; file?: (id: string) => string; jobsDirectory?: string;
  transport?: 'x11' | 'wayland' };

export class X11Clipboard {
  readonly jobs: Jobs;
  private states = new Map<string, Promise<State>>();
  private closed = false;
  constructor(
    private machines: Machines,
    private applicationProject: (id: string) => Promise<X11ApplicationContext>,
    private options: LinuxClipboardOptions = {},
  ) {
    this.jobs = new Jobs(`${this.transport}-clipboard-install`, options.jobsDirectory);
  }
  private get transport() { return this.options.transport || 'x11'; }
  private file(id: string) {
    return this.options.file?.(id) || join(vmDir(id), `${this.transport}-clipboard.json`);
  }
  private state(id: string) {
    this.machines.get(id);
    let task = this.states.get(id);
    if (!task) {
      task = readStore(this.file(id), () => ({
        schemaVersion: 1,
        version: 1,
        owner: randomUUID(),
        applications: [],
      })).then((raw) => x11ClipboardConfiguration.parse(raw));
      this.states.set(id, task);
      void task.catch(() => {
        if (this.states.get(id) === task) this.states.delete(id);
      });
    }
    return task;
  }
  private require(id: string, signal?: AbortSignal) {
    if (this.closed) throw new AppError('Linux 剪贴板服务已关闭', 503);
    signal?.throwIfAborted();
    this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动 Linux 实例', 409);
  }
  private async bundle() {
    return this.transport === 'wayland' ? waylandSourceBundle(this.options.assets) : x11SourceBundle(this.options.assets);
  }
  private directoryScript(bundle: Bundle, create = true) {
    const code = `import stat\nfrom pathlib import Path\np=Path(${JSON.stringify(bundle.directory)})\nc=Path('/')\nfor part in p.parts[1:]:\n c/=part\n ${create ? 'if not c.exists(): c.mkdir(mode=0o755)\n ' : ''}s=c.lstat()\n if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022: raise RuntimeError('原生源码目录身份或权限不符')`;
    return `/usr/bin/python3 -I -S -c ${quote(code)}`;
  }
  private async publish(id: string, bundle: Bundle, name: string, signal?: AbortSignal) {
    this.require(id, signal);
    const data = name === 'manifest.json' && this.transport === 'wayland'
      ? Buffer.from(JSON.stringify(bundle.manifest) + '\n') : bundle.files.get(name)!;
    const file = bundle.manifest.files.find((file) => file.name === name) ||
      { sha256: createHash('sha256').update(data).digest('hex') };
    const staged = bundle.directory + '/.' + randomUUID() + '.new';
    try {
      await this.machines.sftp(
        id,
        async (ftp, transportSignal) => {
          const transferSignal =
            signal && transportSignal
              ? AbortSignal.any([signal, transportSignal])
              : signal || transportSignal;
          await pipeline(
            Readable.from([data]),
            ftp.createWriteStream(staged, { flags: 'wx', mode: 0o600 }),
            { signal: transferSignal },
          );
        },
        signal,
      );
      const result = await this.machines.exec(
        id,
        `set -eu\ntest -f ${quote(staged)} && test ! -L ${quote(staged)}\n` +
          `test "$(sha256sum ${quote(staged)} | cut -d' ' -f1)" = ${file.sha256}\n` +
          `chmod 444 ${quote(staged)}\nmv -f ${quote(staged)} ${quote(bundle.directory + '/' + name)}`,
        10000,
        signal,
      );
      if (result.code !== 0) throw new AppError('Linux 原生源码发布失败', 409);
    } finally {
      await this.machines.exec(id, `rm -f ${quote(staged)}`, 5000).catch(() => {});
    }
  }
  private async controller(id: string, bundle: Bundle, signal?: AbortSignal) {
    this.require(id, signal);
    const file = bundle.directory + '/controller.py',
      expected = bundle.manifest.files.find((file) => file.name === 'controller.py')!;
    const probe = await this.machines.exec(
      id,
      `test -f ${quote(file)} && test ! -L ${quote(file)} && ` +
        `test "$(stat -c %u ${quote(file)})" = 0 && ` +
        `test "$(sha256sum ${quote(file)} | cut -d' ' -f1)" = ${expected.sha256}`,
      10000,
      signal,
    );
    if (probe.code === 0) return;
    const prepared = await this.machines.exec(id, this.directoryScript(bundle), 10000, signal);
    if (prepared.code !== 0) throw new AppError('无法准备 Linux 原生控制器，请先安装桌面及 Python 3', 409);
    await this.publish(id, bundle, 'controller.py', signal);
    if (this.transport === 'wayland') {
      for (const file of bundle.manifest.files) if (file.name !== 'controller.py')
        await this.publish(id, bundle, file.name, signal);
      await this.publish(id, bundle, 'manifest.json', signal);
    }
  }
  private script(bundle: Bundle, request: object) {
    const helper = bundle.manifest.files.find((file) => file.name === 'controller.py')!;
    const file = bundle.directory + '/controller.py';
    return (
      `set -eu\n${this.directoryScript(bundle, false)}\ntest -f ${quote(file)} && test ! -L ${quote(file)}\n` +
      `test "$(stat -c %u ${quote(file)})" = 0\n` +
      `test "$(sha256sum ${quote(file)} | cut -d' ' -f1)" = ${helper.sha256}\n` +
      `exec /usr/bin/python3 -I -S ${quote(file)} ${quote(Buffer.from(JSON.stringify(request)).toString('base64'))}`
    );
  }
  private async command(
    id: string,
    bundle: Bundle,
    request: object,
    signal?: AbortSignal,
    project?: Project,
  ): Promise<unknown> {
    signal?.throwIfAborted();
    const code = this.script(bundle, request);
    const namespace = project && projectNetworkNamespace(project);
    // ip netns exec also remounts sysfs, hiding its cgroup mount. The pinned
    // controller joins only the network namespace after checking the binding.
    const result = await this.machines.exec(
      id,
      namespace ? `set -eu\n${projectNetworkCheckScript(namespace)}\n${code}` : code,
      20000,
      signal,
    );
    let raw: unknown;
    try {
      raw = JSON.parse(result.stdout);
    } catch {
      throw new AppError('Linux 剪贴板控制器尚未安装或输出无效', 503);
    }
    if (result.code !== 0) throw new AppError(z.object({ error: z.string().max(256) }).parse(raw).error, 409);
    return raw;
  }
  private async list(id: string, state: State, bundle: Bundle, signal?: AbortSignal) {
    return inventory.parse(await this.command(id, bundle, { action: 'list', owner: state.owner }, signal));
  }
  async view(id: string, signal?: AbortSignal): Promise<X11ClipboardView> {
    const state = await this.state(id);
    const result: X11ClipboardView = {
      version: state.version,
      applications: state.applications,
      ready: false,
      sessions: [],
      installation: this.jobs.view(id),
    };
    if (this.machines.state(id) !== 'running') return result;
    try {
      const bundle = await this.bundle();
      const value = await this.list(id, state, bundle, signal);
      result.ready = value.ready;
      result.build = value.build;
      result.error = value.error;
      result.sessions = value.sessions.map((row) => {
        const expected = state.applications.find(
          (app) => app.image === row.image && app.sha256 === row.sha256,
        );
        const outdated = row.active
          ? !expected || !row.rule || !matches(expected.rule, row.rule)
          : !!expected;
        return row.state !== 'stopped' && outdated
          ? { ...row, state: 'error', error: '已保存规则尚未应用；请刷新，或停止并重新启动应用' }
          : row;
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      result.error = error instanceof Error ? error.message : '无法检查 Linux 剪贴板状态';
    }
    return result;
  }
  install(id: string) {
    this.require(id);
    return this.jobs.start(
      id,
      async (log, signal) => {
        const bundle = await this.bundle();
        this.require(id, signal);
        const checked = await this.machines.exec(id, this.directoryScript(bundle), 10000, signal);
        if (checked.code !== 0) throw new AppError('无法准备 Linux 原生源码目录', 409);
        for (const file of bundle.manifest.files) {
          await this.publish(id, bundle, file.name, signal);
        }
        if (this.transport === 'wayland') await this.publish(id, bundle, 'manifest.json', signal);
        const distro = this.machines.get(id).distro;
        const dependencies =
          this.transport === 'wayland'
            ? distro === 'alpine' ? 'apk add --no-cache --timeout 30 dbus python3'
              : 'export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update\n' +
                'apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y --no-install-recommends dbus python3'
            : distro === 'alpine'
            ? 'apk add --no-cache --timeout 30 g++ libx11-dev libxcb-dev dbus python3'
            : 'export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update\n' +
              'apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y --no-install-recommends g++ libx11-dev libx11-xcb-dev libxcb1-dev dbus python3';
        const manifestWriter =
          `import hashlib,json,os\nfrom pathlib import Path\np=Path(${JSON.stringify(bundle.directory)})\n` +
          `q=p/'libSakuraClipboard.so'\nq.chmod(0o555)\nb=q.read_bytes()\n` +
          `m={'version':1,'build':${JSON.stringify(bundle.manifest.build)},'sha256':hashlib.sha256(b).hexdigest()}\n` +
          `f=p/'library.json.new'\nwith f.open('w') as s: json.dump(m,s);s.flush();os.fsync(s.fileno())\nf.chmod(0o444)\nos.replace(f,p/'library.json')`;
        const prepare = this.transport === 'wayland'
          ? `/usr/bin/python3 -I -S -c ${quote("import ast,pathlib\nfor name in ('controller.py','proxy.py'): ast.parse(pathlib.Path(name).read_bytes(),filename=name)")}`
          : `g++ -std=c++17 -O2 -Wall -Wextra -fPIC -shared -Wl,-z,relro,-z,now ` +
            `-DSAKURA_CLIPBOARD_BUILD=${quote('"' + bundle.manifest.build + '"')} policy.cpp ` +
            `-o libSakuraClipboard.so.new -lX11 -lX11-xcb -lxcb -ldl -pthread\n` +
            `chmod 555 libSakuraClipboard.so.new\n` +
            `mv -f libSakuraClipboard.so.new libSakuraClipboard.so\n/usr/bin/python3 -I -S -c ${quote(manifestWriter)}`;
        const label = this.transport === 'wayland' ? 'Wayland' : 'Linux X11';
        log(`正在安装依赖并准备 ${label} 剪贴板代理…\n`);
        const build = await guestTask(
          this.machines,
          id,
          `set -eu\n${dependencies}\ncd ${quote(bundle.directory)}\n` +
            prepare,
          signal,
          log,
        );
        if (build.code !== 0) throw new AppError('Linux 原生剪贴板编译失败，请查看安装日志', 409);
        this.require(id, signal);
        const state = await this.state(id),
          actual = await this.list(id, state, bundle, signal);
        if (!actual.ready) throw new AppError(actual.error || 'Linux 原生剪贴板未就绪', 409);
        log(`${label} 剪贴板代理已就绪。\n`);
      },
      { title: `安装 ${this.transport === 'wayland' ? 'Wayland' : 'Linux X11'} 剪贴板代理`, vmId: id, action: 'install' },
    );
  }
  private async reconcile(id: string, state: State, bundle: Bundle, signal?: AbortSignal) {
    const actual = await this.list(id, state, bundle, signal);
    const errors: string[] = [];
    for (const row of actual.sessions) {
      if (row.state === 'stopped' || !row.image) continue;
      const application = state.applications.find(
        (app) => app.image === row.image && app.sha256 === row.sha256,
      );
      if (!application && state.applications.some((app) => app.image === row.image)) {
        errors.push('已运行应用的文件身份与配置不符，请停止并重新启动应用');
        continue;
      }
      if (row.active === !!application && (!application || (row.rule && matches(row.rule, application.rule))))
        continue;
      try {
        this.require(id, signal);
        await this.command(
          id,
          bundle,
          {
            action: 'configure',
            owner: state.owner,
            id: row.id,
            enabled: !!application,
            generation: state.version,
            rule: application?.rule || defaultClipboardRule(),
          },
          signal,
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        errors.push(error instanceof Error ? error.message : '应用规则更新失败');
      }
    }
    return errors;
  }
  async action(id: string, raw: unknown, signal?: AbortSignal): Promise<unknown> {
    const request = x11ClipboardRequest.parse(raw);
    this.require(id, signal);
    if (request.action === 'install') return this.install(id);
    return this.machines.locked(`${this.transport}-clipboard:${id}`, async () => {
      this.require(id, signal);
      let state = await this.state(id);
      const bundle = await this.bundle();
      await this.controller(id, bundle, signal);
      if (request.action === 'identify')
        return z
          .object({ image, sha256: digest })
          .strict()
          .parse(await this.command(id, bundle, { ...request, owner: state.owner }, signal));
      if (request.action === 'stop' || request.action === 'forget')
        return this.command(id, bundle, { ...request, owner: state.owner }, signal);
      if ('version' in request && request.version !== state.version)
        throw new AppError('Linux 剪贴板配置已变化，请刷新', 409);
      if (request.action === 'launch') {
        const application = state.applications.find((app) => app.image === request.image);
        if (!application) throw new AppError('请先绑定应用并保存剪贴板规则', 409);
        const { project, launcherSha256 } = await this.applicationProject(id);
        this.require(id, signal);
        const sessionId = randomUUID();
        // Persist the owner before any guest process can survive this service.
        await writeStore(this.file(id), state);
        this.require(id, signal);
        try {
          const environment = Object.fromEntries(
            Object.entries(project.environment || {})
              .filter(
                ([key]) =>
                  !/^(?:LD_|SAKURA_CLIPBOARD_|HOME$|USER$|LOGNAME$|DISPLAY$|XAUTHORITY$|DBUS_|WAYLAND_|XDG_|SESSION_MANAGER$|PATH$)/.test(
                    key,
                  ) && !(this.transport === 'wayland' && /^(?:QT_QPA_PLATFORM|GDK_BACKEND|SDL_VIDEODRIVER)$/.test(key)),
              )
              .map(([key, value]) => [key, createHash('sha256').update(value).digest('hex')]),
          );
          return session.parse(
            await this.command(
              id,
              bundle,
              {
                action: 'launch',
                owner: state.owner,
                id: sessionId,
                image: application.image,
                sha256: application.sha256,
                args: request.args,
                rule: application.rule,
                generation: state.version,
                projectId: project._workspace || 'default',
                directory: project.directory,
                networkNamespace: projectNetworkNamespace(project),
                environment,
                launcherSha256,
              },
              signal,
              project,
            ),
          );
        } catch (error) {
          // The guest owner lock serializes cleanup after a request with an
          // unknown outcome; only this newly allocated session can be stopped.
          await this.command(id, bundle, { action: 'stop', owner: state.owner, id: sessionId }).catch(
            () => {},
          );
          throw error;
        }
      }
      if (request.action === 'save' || request.action === 'remove') {
        if (request.action === 'save') {
          const actual = z
            .object({ image, sha256: digest })
            .strict()
            .parse(
              await this.command(
                id,
                bundle,
                { action: 'identify', owner: state.owner, image: request.application.image },
                signal,
              ),
            );
          if (actual.image !== request.application.image || actual.sha256 !== request.application.sha256)
            throw new AppError('应用路径或文件摘要已变化，请重新读取应用身份', 409);
        }
        const path = request.action === 'save' ? request.application.image : request.image;
        const applications = state.applications.filter((app) => app.image !== path);
        if (request.action === 'save') applications.push(request.application);
        const next = x11ClipboardConfiguration.parse({ ...state, version: state.version + 1, applications });
        this.require(id, signal);
        await writeStore(this.file(id), next);
        state = next;
        this.states.set(id, Promise.resolve(next));
      }
      const errors = await this.reconcile(id, state, bundle, signal);
      const value = await this.view(id, signal);
      if (errors.length) value.error = [...new Set(errors)].join('；');
      return value;
    });
  }
  async close() {
    this.closed = true;
    await this.jobs.close();
  }
}
