import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, guestPath, vmDir } from './model.ts';
import type { Machines } from './machines.ts';
import type { Project } from './workspaces.ts';
import { projectIdSchema } from './project-catalog.ts';
import { quote } from './files.ts';
import { writeStore } from './local-store.ts';
import { envPrefix } from './project-services.ts';
import { projectNetworkCommand, ensureProjectNetworkScript,
  projectNetworkNamespace, projectNetworkCheckScript } from './project-network-isolation.ts';
import { uidCleanupScript } from './single-app-sandbox.ts';

export const desktopLauncherPath = '/usr/local/libexec/sakura-desktop-launcher';
export const desktopBindingSchema = z.object({ version: z.literal(1),
  projectId: projectIdSchema, directory: z.string().max(4096).refine((value) => {
    try { guestPath(value); return true; } catch { return false; }
  }),
  networkIsolation: z.enum(['host', 'private']),
  launcherSha256: z.string().regex(/^[a-f0-9]{64}$/),
  enabled: z.boolean(),
}).strict();
export type DesktopBinding = z.infer<typeof desktopBindingSchema>;

export function bindingProject(binding: DesktopBinding): Project {
  return { template: 'none', directory: binding.directory, setup: '', command: '', repository: '',
    networkIsolation: binding.networkIsolation,
    _workspace: binding.projectId === 'default' ? undefined : binding.projectId };
}

export function desktopServiceStop(distro = 'alpine') {
  return distro === 'alpine'
    ? 'rc-update del sakura-desktop default >/dev/null 2>&1 || true\n' +
      'if rc-service sakura-desktop status >/dev/null 2>&1; then rc-service sakura-desktop stop; fi\n' +
      '! rc-service sakura-desktop status >/dev/null 2>&1'
    : 'if systemctl cat sakura-desktop >/dev/null 2>&1; then systemctl disable --now sakura-desktop; fi';
}

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

export function desktopBindingCheck(binding: DesktopBinding) {
  return `test -f ${desktopLauncherPath} && test ! -L ${desktopLauncherPath} && ` +
    `test "$(stat -c %u ${desktopLauncherPath})" = 0 && ` +
    `test "$(sha256sum ${desktopLauncherPath} | cut -d' ' -f1)" = ${binding.launcherSha256}`;
}

export class DesktopBindings {
  constructor(private machines: Machines) {}
  async read(id: string) {
    this.machines.get(id);
    try {
      return desktopBindingSchema.parse(JSON.parse(await readFile(join(vmDir(id), 'desktop-binding.json'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async write(id: string, project: Project, signal?: AbortSignal) {
    const script = desktopLauncher(project, this.machines.get(id).distro || 'alpine');
    const binding = desktopBindingSchema.parse({ version: 1, projectId: project._workspace || 'default',
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

  async enable(id: string, binding: DesktopBinding, enabled: boolean) {
    const current = await this.read(id);
    if (!current || current.launcherSha256 !== binding.launcherSha256)
      throw new AppError('桌面启动绑定已变化，请重试', 409);
    await writeStore(join(vmDir(id), 'desktop-binding.json'), { ...current, enabled });
  }

  async clear(id: string) {
    this.machines.get(id);
    await rm(join(vmDir(id), 'desktop-binding.json'), { force: true });
  }
}
