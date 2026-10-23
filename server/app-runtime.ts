/** 固定 VM 创建、磁盘与启动身份的宿主适配；不依赖当前选中项目。 */
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { AppTargetsV1 } from './service-contracts/app-runtime.ts';
import type { AppTarget } from '../shared/contracts/app-runtime.ts';
import { vmDir } from './paths.ts';
import { AppError } from '../shared/errors.ts';
import { appHash, appRequire } from './app-store.ts';
import { quote } from './shell.ts';
import { projectIdentityTask, ProjectRunScopes } from './project-run-scope.ts';
export async function appDiskIdentity(vmId: string) {
  const p = join(vmDir(vmId), 'disk.qcow2'),
    s = await lstat(p);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) throw new AppError('应用磁盘身份无效', 409);
  return appHash([p, s.dev, s.ino, s.birthtimeMs]);
}
export async function appBoot(m: VmAccess, vmId: string) {
  const r = await m.exec(vmId, 'cat /proc/sys/kernel/random/boot_id', 10000);
  if (r.code || !r.stdout.trim()) throw new AppError('无法核验客户机启动身份', 409);
  return r.stdout.trim();
}
export async function appTarget(targets: AppTargetsV1, appId: string) {
  return appRequire((await targets.view(appId)).targets[0], '应用目标不存在');
}
export async function appCheck(m: VmAccess, t: AppTarget, boot = true) {
  const vm = m.get(t.vmId);
  if (vm.sandbox || vm.rescueOf || vm.managedNetwork !== 'isolated')
    throw new AppError('应用需要持久隔离实例，拒绝临时或救援目标', 409);
  if (vm.createdAt !== t.vmCreatedAt || (await appDiskIdentity(t.vmId)) !== t.diskIdentity)
    throw new AppError('应用目标或磁盘身份变化', 409);
  if (boot && (m.state(t.vmId) !== 'running' || (await appBoot(m, t.vmId)) !== t.bootId))
    throw new AppError('应用启动身份变化，须核销原操作', 409);
}
export async function appWaitRunning(m: VmAccess, id: string, signal?: AbortSignal) {
  const end = Date.now() + 240000;
  while (m.state(id) === 'starting' && Date.now() < end) await delay(200, undefined, { signal });
  if (m.state(id) !== 'running') throw new AppError('应用实例未能启动', 409);
}
export async function appExec(
  m: VmAccess,
  t: AppTarget,
  command: string,
  timeout = 30000,
  signal?: AbortSignal,
) {
  await appCheck(m, t);
  const live = m.live.get(t.vmId);
  const result = await m.exec(t.vmId, command, timeout, signal);
  if (m.live.get(t.vmId) !== live) throw new AppError('命令期间运行身份变化', 409);
  if (result.code !== 0) throw new AppError('应用操作失败：' + result.stderr.slice(0, 2000), 409);
  return result;
}
export async function appRunProject(
  m: VmAccess,
  w: WorkspacesV1,
  t: AppTarget,
  action: 'start' | 'stop' | 'setup',
  signal?: AbortSignal,
) {
  await appCheck(m, t);
  await appProject(m, w, t);
  return w.projects.with(t.vmId, t.projectId, async () => {
    const j = action === 'setup' ? await w.run(t.vmId, action) : await w.runPrepared(t.vmId, action);
    const key = j.key || t.vmId;
    await w.jobs.wait(key);
    signal?.throwIfAborted();
    const done = w.jobs.view(key);
    if (done?.status !== 'done')
      throw new AppError('项目服务操作未完成：' + (done?.error || done?.status), 409);
    await appCheck(m, t);
    return done;
  });
}
export async function appWrite(m: VmAccess, t: AppTarget, path: string, data: Buffer, mode = 0o600) {
  if (!path.startsWith(t.directory + '/')) throw new AppError('写入超出应用目录', 403);
  await appCheck(m, t);
  await m.sftp(t.vmId, async (ftp) => {
    const handle = await new Promise<Buffer>((ok, no) =>
      ftp.open(path, 'wx', { mode }, (e, h) => (e ? no(e) : ok(h))),
    );
    try {
      let n = 0;
      while (n < data.length) {
        const size = Math.min(512 * 1024, data.length - n);
        await new Promise<void>((ok, no) => ftp.write(handle, data, n, size, n, (e) => (e ? no(e) : ok())));
        n += size;
      }
    } finally {
      await new Promise<void>((ok, no) => ftp.close(handle, (e) => (e ? no(e) : ok())));
    }
  });
}
export function appEnvFile(values: Record<string, string>) {
  return Buffer.from(
    Object.entries(values)
      .map(([k, v]) => `export ${k}=${quote(v)}`)
      .join('\n') + '\n',
  );
}
export async function appProject(m: VmAccess, w: WorkspacesV1, t: AppTarget) {
  const p = await w.projects.with(t.vmId, t.projectId, () => w.config(t.vmId));
  if (
    p.directory !== t.directory ||
    p.template !== 'none' ||
    p.networkIsolation !== 'host' ||
    p.repository ||
    p.setup ||
    p.services?.length ||
    Object.keys(p.runtimes || {}).length ||
    Object.keys(p.environment || {}).length ||
    Object.keys(p.secrets || {}).length
  )
    throw new AppError('应用项目目录或运行配置已在外部修改，拒绝继续执行', 409);
  return { ...p, _workspace: t.projectId };
}
export async function appUserExec(
  m: VmAccess,
  w: WorkspacesV1,
  t: AppTarget,
  command: string,
  timeout = 60000,
  signal: AbortSignal = new AbortController().signal,
) {
  await appCheck(m, t);
  const p = await appProject(m, w, t);
  const out = await projectIdentityTask(
    m,
    t.vmId,
    p,
    { command, environment: {} },
    signal,
    undefined,
    timeout,
    undefined,
    undefined,
    { expectedLive: m.live.get(t.vmId) },
  );
  if (out.code !== 0) throw new AppError('应用命令未通过，退出码 ' + out.code, 409);
  return out;
}
export async function appOwnDirectory(m: VmAccess, w: WorkspacesV1, t: AppTarget, path: string) {
  if (path !== t.directory && !path.startsWith(t.directory + '/'))
    throw new AppError('目录超出应用范围', 403);
  const identity = await new ProjectRunScopes(m).reserve(t.vmId, await appProject(m, w, t));
  await appExec(m, t, `chown ${identity.uid}:${identity.gid} ${quote(path)}`);
  return identity;
}
