/**
 * 模块职责：保存桌面启动器与完整项目会话绑定；连接必须匹配已发布的启动器摘要。
 * Module purpose: Persists launchers and full project desktop bindings; connections require the exact published launcher digest.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { AppError } from '../shared/errors.ts';
import { guestPath } from '../shared/paths.ts';
import { vmDir } from './paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import type { Project } from './project-config.ts';
import { projectIdSchema } from './project-catalog.ts';
import { quote } from './shell.ts';
import { writeStore } from './local-store.ts';
import { envPrefix } from './project-services.ts';
import {
  projectNetworkCommand,
  ensureProjectNetworkScript,
  projectNetworkNamespace,
  projectNetworkCheckScript,
} from './project-network-isolation.ts';
import { uidCleanupScript } from './single-app-sandbox.ts';
import { desktopPreferencesSchema } from '../shared/desktop-preferences.ts';
import { projectIdentitySchema, projectIdentityRunSchema } from './project-identity.ts';
import { projectDesktopRecordSchema } from './project-service-scope.ts';
import { desktopEndpointSchema } from './desktop-project-control.ts';

export const desktopLauncherPath = '/usr/local/libexec/sakura-desktop-launcher';
export const legacyDesktopBindingSchema = z.object({ version: z.literal(1),
  projectId: projectIdSchema, directory: z.string().max(4096).refine((value) => {
    try { guestPath(value); return true; } catch { return false; }
  }),
  networkIsolation: z.enum(['host', 'private']),
  launcherSha256: z.string().regex(/^[a-f0-9]{64}$/),
  enabled: z.boolean(),
}).strict();
/**
 * 入口 / Entry: callback@48.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.object().strict().superRefine）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.object().strict().superRefine).
 * 输入 / Inputs: value; ctx
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `ctx.addIssue`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const projectDesktopBindingSchema = z.object({
  ...legacyDesktopBindingSchema.shape, version: z.literal(2), configVersion: z.string().regex(/^[a-f0-9]{64}$/),
  preferences: desktopPreferencesSchema, state: z.enum(['starting', 'running', 'review', 'stopped']),
  execution: z.object({ identity: projectIdentitySchema, record: projectDesktopRecordSchema,
    run: projectIdentityRunSchema.nullable(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    runtime: z.string(), endpoint: desktopEndpointSchema.nullable(), build: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const { identity, record, run, sha256, runtime, build } = value.execution;
  if (identity.phase !== 'active' || identity.projectId !== value.projectId || identity.directory !== value.directory ||
      identity.networkIsolation !== value.networkIsolation || record.projectId !== value.projectId ||
      value.launcherSha256 !== sha256 || runtime !== '/run/sakura-desktop-uid/' + identity.uid + '/' + record.runId ||
      run && (run.runId !== record.runId || run.projectId !== value.projectId || run.identityId !== identity.identityId ||
        run.registryId !== identity.registryId || run.revision !== identity.revision || run.bootId !== record.bootId ||
        run.build !== build || run.cgroupName !== record.scopeName || run.cgroupInode !== record.inode || run.mode !== 'inherit-current') ||
      value.state === 'running' && (!run || run.phase !== 'active' || record.phase !== 'running' || !value.execution.endpoint) ||
      value.state === 'stopped' && record.phase !== 'stopped')
    ctx.addIssue({ code: 'custom', message: 'Desktop 项目与完整会话票据不符' });
});
export const desktopBindingSchema = z.union([legacyDesktopBindingSchema, projectDesktopBindingSchema]);
export type DesktopBinding = z.infer<typeof desktopBindingSchema>;
export type ProjectDesktopBinding = z.infer<typeof projectDesktopBindingSchema>;

/**
 * 入口 / Entry: bindingProject.
 * 功能：从当前输入或状态计算 `{ template: 'none', directory: binding.directory, setup: '', command: '', repository: '', networkIsolation: binding.networkIs…`，供调用方后续验证或使用。
 * Purpose: Computes `{ template: 'none', directory: binding.directory, setup: '', command: '', repository: '', networkIsolation: binding.networkIs…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: binding: DesktopBinding
 * 输出 / Returns: Project；结果来自 / values from `{ template: 'none', directory: binding.directory, setup: '', command: '', repository: '', networkIsolation: binding.networkIs…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function bindingProject(binding: DesktopBinding): Project {
  return { template: 'none', directory: binding.directory, setup: '', command: '', repository: '',
    networkIsolation: binding.networkIsolation,
    _workspace: binding.projectId === 'default' ? undefined : binding.projectId };
}

/**
 * 入口 / Entry: desktopServiceStop.
 * 功能：从当前输入或状态计算 `distro === 'alpine' ? 'rc-update del sakura-desktop default >/dev/null 2>&1 || true\n' + 'if rc-service sakura-desktop status…`，供调用方后续验证或使用。
 * Purpose: Computes `distro === 'alpine' ? 'rc-update del sakura-desktop default >/dev/null 2>&1 || true\n' + 'if rc-service sakura-desktop status…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: distro: default='alpine'
 * 输出 / Returns: `distro === 'alpine' ? 'rc-update del sakura-desktop default >/dev/null 2>&1 || true\n' + 'if rc-service sakura-desktop status…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function desktopServiceStop(distro = 'alpine') {
  return distro === 'alpine'
    ? 'rc-update del sakura-desktop default >/dev/null 2>&1 || true\n' +
      'if rc-service sakura-desktop status >/dev/null 2>&1; then rc-service sakura-desktop stop; fi\n' +
      '! rc-service sakura-desktop status >/dev/null 2>&1'
    : 'if systemctl cat sakura-desktop >/dev/null 2>&1; then systemctl disable --now sakura-desktop; fi';
}

/**
 * 入口 / Entry: desktopLauncher.
 * 功能：在保存桌面启动器与完整项目会话绑定中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``#!/bin/sh if [ "\${1-}" != --session ]; then exec /usr/bin/python3 -I -S -c ${quote(`import os if os.getpgrp()!=os.getpid():…` 供上层消费（`desktop-binding.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `desktop-binding.ts`; this entry produces ``#!/bin/sh if [ "\${1-}" != --session ]; then exec /usr/bin/python3 -I -S -c ${quote(`import os if os.getpgrp()!=os.getpid():…` for its caller. Module context: Persists launchers and full project desktop bindings; connections require the exact published launcher digest.
 * 处理：通过 `projectNetworkNamespace`, `envPrefix`, `quote`, `projectNetworkCheckScript` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `projectNetworkNamespace`, `envPrefix`, `quote`, `projectNetworkCheckScript`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project; distro: default='alpine'
 * 输出 / Returns: ``#!/bin/sh if [ "\${1-}" != --session ]; then exec /usr/bin/python3 -I -S -c ${quote(`import os if os.getpgrp()!=os.getpid():…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function desktopLauncher(project: Project, distro = 'alpine') {
  const namespace = projectNetworkNamespace(project);
  const credentials = distro === 'alpine' ? '/bin/setpriv' : '/usr/bin/setpriv';
  // Runtime and display identity belong to the desktop service. Other project
  // environment values are exported only after both setns and the UID change.
  const environment = Object.fromEntries(Object.entries(project.environment || {}).filter(([key]) =>
    !['HOME', 'USER', 'LOGNAME', 'DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR',
      'DBUS_SESSION_BUS_ADDRESS', 'WAYLAND_DISPLAY', 'WAYLAND_SOCKET', 'SESSION_MANAGER'].includes(key)));
  const child = `set -eu\n${envPrefix(environment)}\ncd ${quote(project.directory)}\n` +
    'exec /usr/local/libexec/sakura-desktop-session';
  return `#!/bin/sh
if [ "\${1-}" != --session ]; then
  exec /usr/bin/python3 -I -S -c ${quote(`import os
if os.getpgrp()!=os.getpid(): os.setsid()
os.execv('/bin/sh',['sh',${JSON.stringify(desktopLauncherPath)},'--session'])`)}
fi
set -eu
uid=$(id -u sakura-desktop)
test "$uid" -ge 1000
gid=$(id -g sakura-desktop)
test "$gid" -ge 1000
test "$(awk -F: '$1 == "sakura-desktop" { print $6 }' /etc/passwd)" = /home/sakura-desktop
test ! -L /run/sakura-desktop
mkdir -p /run/sakura-desktop
chown sakura-desktop:sakura-desktop /run/sakura-desktop
chmod 700 /run/sakura-desktop
${namespace ? `if ip netns exec ${namespace} true >/dev/null 2>&1; then\n${projectNetworkCheckScript(namespace)}\nfi\n` : ''}${ensureProjectNetworkScript(project, distro)}
child=''
cleanup() {
  trap - EXIT HUP INT TERM
  ${uidCleanupScript(1000, 'SAKURA_DESKTOP_UID')}
  [ -z "$child" ] || wait "$child" 2>/dev/null || true
}
export SAKURA_DESKTOP_UID="$uid"
export SAKURA_DESKTOP_GID="$gid"
trap cleanup EXIT
trap 'exit 129' HUP INT TERM
${projectNetworkCommand(project, `exec env -i HOME=/home/sakura-desktop USER=sakura-desktop LOGNAME=sakura-desktop ` +
  `SHELL=/bin/sh PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin ` +
  `${credentials} --reuid "$SAKURA_DESKTOP_UID" --regid "$SAKURA_DESKTOP_GID" --init-groups --no-new-privs /bin/sh -c ${quote(child)}`)} &
child=$!
wait "$child"
`;
}

/**
 * 入口 / Entry: desktopBindingCheck.
 * 功能：在保存桌面启动器与完整项目会话绑定中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``test -f ${desktopLauncherPath} && test ! -L ${desktopLauncherPath} && ` + `test "$(stat -c %u ${desktopLauncherPath})" = 0 &…` 供上层消费（`desktop-binding.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `desktop-binding.ts`; this entry produces ``test -f ${desktopLauncherPath} && test ! -L ${desktopLauncherPath} && ` + `test "$(stat -c %u ${desktopLauncherPath})" = 0 &…` for its caller. Module context: Persists launchers and full project desktop bindings; connections require the exact published launcher digest.
 * 输入 / Inputs: binding: DesktopBinding
 * 输出 / Returns: ``test -f ${desktopLauncherPath} && test ! -L ${desktopLauncherPath} && ` + `test "$(stat -c %u ${desktopLauncherPath})" = 0 &…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `binding.version !== 1`; 异常 / errors `new AppError('项目 Desktop 需要完整 UID 会话验证', 409, 'DESKTOP_SCOPE_CHANGED')`.
 */
export function desktopBindingCheck(binding: DesktopBinding) {
  if (binding.version !== 1) throw new AppError('项目 Desktop 需要完整 UID 会话验证', 409, 'DESKTOP_SCOPE_CHANGED');
  return `test -f ${desktopLauncherPath} && test ! -L ${desktopLauncherPath} && ` +
    `test "$(stat -c %u ${desktopLauncherPath})" = 0 && ` +
    `test "$(sha256sum ${desktopLauncherPath} | cut -d' ' -f1)" = ${binding.launcherSha256}`;
}

export class DesktopBindings {
  /**
   * 入口 / Entry: DesktopBindings.constructor.
   * 功能：建立 DesktopBindings 的保存桌面启动器与完整项目会话绑定上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the DesktopBindings context for this module's responsibility: Persists launchers and full project desktop bindings; connections require the exact published launcher digest. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines) {}
  /**
   * 入口 / Entry: DesktopBindings.read.
   * 功能：在保存桌面启动器与完整项目会话绑定中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `desktopBindingSchema.parse(JSON.parse(await readFile(join(vmDir(id), 'desktop-binding.json'), 'utf8')))` / `null` 供上层消费（`DesktopBindings`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `DesktopBindings`; this entry produces `desktopBindingSchema.parse(JSON.parse(await readFile(join(vmDir(id), 'desktop-binding.json'), 'utf8')))` / `null` for its caller. Module context: Persists launchers and full project desktop bindings; connections require the exact published launcher digest.
   * 处理：通过 `this.machines.get`, `desktopBindingSchema.parse`, `readFile`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `desktopBindingSchema.parse`, `readFile`, `join`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `(error as NodeJS.ErrnoException).code === 'ENOENT'`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `desktopBindingSchema.parse(JSON.parse(await readFile(join(vmDir(id), 'desktop-binding.json'), 'utf8')))`; `null`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async read(id: string) {
    this.machines.get(id);
    try {
      return desktopBindingSchema.parse(JSON.parse(await readFile(join(vmDir(id), 'desktop-binding.json'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * 入口 / Entry: DesktopBindings.write.
   * 功能：在保存桌面启动器与完整项目会话绑定中，校验并提交领域状态变更；本入口产生 `binding` 供上层消费（`DesktopBindings`）。
   * Purpose: Validates and commits a domain state change in `DesktopBindings`; this entry produces `binding` for its caller. Module context: Persists launchers and full project desktop bindings; connections require the exact published launcher digest.
   * 处理：通过 `desktopLauncher`, `this.machines.get`, `legacyDesktopBindingSchema.parse`, `createHash().update().digest` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `desktopLauncher`, `this.machines.get`, `legacyDesktopBindingSchema.parse`, `createHash().update().digest`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; project: Project; signal: AbortSignal optional
   * 输出 / Returns: `binding`.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`; `writeStore`; `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `prepared.code !== 0`; `result.code !== 0`; 异常 / errors `new AppError('无法准备桌面启动程序', 409)`; `new AppError('无法发布项目桌面启动程序', 409)`.
   */
  async write(id: string, project: Project, signal?: AbortSignal) {
    const script = desktopLauncher(project, this.machines.get(id).distro || 'alpine');
    const binding = legacyDesktopBindingSchema.parse({ version: 1, projectId: project._workspace || 'default',
      directory: project.directory, networkIsolation: project.networkIsolation || 'host',
      enabled: false,
      launcherSha256: createHash('sha256').update(script).digest('hex') });
    // Publishing metadata first makes an interrupted guest write fail closed:
    // connections require this exact launcher hash rather than using an old one.
    await writeStore(join(vmDir(id), 'desktop-binding.json'), binding);
    const prepared = await this.machines.exec(id, `mkdir -p /usr/local/libexec ${quote(project.directory)}`, 10000, signal);
    if (prepared.code !== 0) throw new AppError('无法准备桌面启动程序', 409);
    const staged = desktopLauncherPath + '.' + randomUUID() + '.new';
    await this.machines.sftp(id, async (ftp, transportSignal) => {
      const transferSignal = signal && transportSignal ? AbortSignal.any([signal, transportSignal]) : signal || transportSignal;
      try {
        await pipeline(Readable.from([Buffer.from(script)]),
          ftp.createWriteStream(staged, { flags: 'wx', mode: 0o700 }), { signal: transferSignal });
      } catch (error) {
        if (!transportSignal?.aborted) await new Promise<void>((resolve) => ftp.unlink(staged, () => resolve()));
        throw error;
      }
    }, signal);
    const result = await this.machines.exec(id, `set -eu\nchmod 700 ${staged}\n` +
      `test "$(stat -c %u ${staged})" = 0\n` +
      `test "$(sha256sum ${staged} | cut -d' ' -f1)" = ${binding.launcherSha256}\n` +
      `mv -f ${staged} ${desktopLauncherPath}`, 10000, signal);
    if (result.code !== 0) throw new AppError('无法发布项目桌面启动程序', 409);
    return binding;
  }

  /**
   * 入口 / Entry: DesktopBindings.enable.
   * 功能：在保存桌面启动器与完整项目会话绑定中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`DesktopBindings`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DesktopBindings`; the calls and state transitions below complete the operation. Module context: Persists launchers and full project desktop bindings; connections require the exact published launcher digest.
   * 处理：通过 `this.read`, `isDeepStrictEqual`, `writeStore`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.read`, `isDeepStrictEqual`, `writeStore`, `join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; binding: DesktopBinding; enabled: boolean
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`.
   * 拒绝 / Refusals: 条件 / conditions `!current || !isDeepStrictEqual(current, binding)`; 异常 / errors `new AppError('桌面启动绑定已变化，请重试', 409)`.
   */
  async enable(id: string, binding: DesktopBinding, enabled: boolean) {
    const current = await this.read(id);
    if (!current || !isDeepStrictEqual(current, binding))
      throw new AppError('桌面启动绑定已变化，请重试', 409);
    await writeStore(join(vmDir(id), 'desktop-binding.json'), { ...current, enabled });
  }

  /**
   * 入口 / Entry: DesktopBindings.save.
   * 功能：在保存桌面启动器与完整项目会话绑定中，校验并提交领域状态变更；完成下述调用及状态处理（`DesktopBindings`）。
   * Purpose: Validates and commits a domain state change in `DesktopBindings`; the calls and state transitions below complete the operation. Module context: Persists launchers and full project desktop bindings; connections require the exact published launcher digest.
   * 处理：通过 `this.read`, `isDeepStrictEqual`, `writeStore`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.read`, `isDeepStrictEqual`, `writeStore`, `join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; binding: ProjectDesktopBinding; previous: DesktopBinding | null
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`.
   * 拒绝 / Refusals: 条件 / conditions `!isDeepStrictEqual(current, previous)`; `current?.version === 1`; `current?.version === 2 && current.execution.record.runId !== binding.execution.record.runId && current.state !== 'stopped'`; 异常 / errors `new AppError('Desktop 原绑定已变化，拒绝覆盖', 409, 'DESKTOP_SCOPE_CHANGED')`; `new AppError('旧共享 Desktop 没有完整 UID 票据，只能审阅，不能自动接管', 409, 'DESKTOP_LEGACY_REVIEW_REQUIRED')`.
   */
  async save(id: string, binding: ProjectDesktopBinding, previous: DesktopBinding | null) {
    const current = await this.read(id);
    if (!isDeepStrictEqual(current, previous))
      throw new AppError('Desktop 原绑定已变化，拒绝覆盖', 409, 'DESKTOP_SCOPE_CHANGED');
    if (current?.version === 1)
      throw new AppError('旧共享 Desktop 没有完整 UID 票据，只能审阅，不能自动接管', 409, 'DESKTOP_LEGACY_REVIEW_REQUIRED');
    if (current?.version === 2 && current.execution.record.runId !== binding.execution.record.runId && current.state !== 'stopped')
      throw new AppError('原 Desktop 完整运行域尚未核销，拒绝覆盖', 409, 'DESKTOP_SCOPE_CHANGED');
    await writeStore(join(vmDir(id), 'desktop-binding.json'), projectDesktopBindingSchema.parse(binding));
  }

  /**
   * 入口 / Entry: DesktopBindings.clear.
   * 功能：在保存桌面启动器与完整项目会话绑定中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`DesktopBindings`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DesktopBindings`; the calls and state transitions below complete the operation. Module context: Persists launchers and full project desktop bindings; connections require the exact published launcher digest.
   * 处理：通过 `this.machines.get`, `rm`, `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `rm`, `join`, `vmDir`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `rm`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async clear(id: string) {
    this.machines.get(id);
    await rm(join(vmDir(id), 'desktop-binding.json'), { force: true });
  }
}
