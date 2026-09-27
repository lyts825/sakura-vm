import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { AppError } from './model.ts';
import { quote } from './files.ts';
import { projectQuota } from './project-quota.ts';

export const guestQuotaShape = {
  mode: z.enum(['status', 'set', 'clear']).default('status'),
  uid: z.number().int().min(1).max(60000).default(1000),
  hardMiB: z.number().int().min(1).max(102400).default(256),
};
export const guestQuotaSchema = z.object(guestQuotaShape).strict();

export async function guestQuota(
  machines: Machines,
  workspaces: Workspaces,
  vmId: string,
  input: unknown,
  action: 'check' | 'run',
  signal?: AbortSignal,
) {
  const options = guestQuotaSchema.parse(input);
  const readOnly = action === 'check' || options.mode === 'status';
  const projectId = workspaces.projects.current(vmId);
  const volume = await projectQuota(machines, workspaces, vmId, {}, 'check', signal);
  if (!volume.ready || !volume.active || !volume.directory)
    return { ready: false, executed: false, active: false, projectId, report: '',
      reason: '请先为当前项目启用项目磁盘配额，并确保卷已挂载。' };
  const directory = volume.directory;
  const exec = async (script: string, timeout = 30000, tolerate = false) => {
    if (readOnly) signal?.throwIfAborted();
    const result = await machines.exec(vmId, script, timeout, readOnly ? signal : undefined);
    if (result.code !== 0 && !tolerate)
      throw new AppError(result.stderr.trim() || result.stdout.trim() || '客户机用户配额操作失败', 409);
    return result;
  };
  const inspect = async () => {
    const tools = await exec('for tool in quotaon quotacheck setquota repquota; do command -v "$tool" >/dev/null || echo "$tool"; done');
    const missing = tools.stdout.trim().split(/\r?\n/).filter(Boolean);
    if (missing.length)
      return { ready: false, active: false, missing, report: '',
        reason: `客户机缺少 ${missing.join('、')}；Alpine 安装 quota-tools，Debian/Ubuntu 安装 quota。` };
    if (machines.get(vmId).distro === 'ubuntu') {
      const modules = await exec(
        'command -v modinfo >/dev/null && modinfo -n quota_v2 >/dev/null && modinfo -n quota_tree >/dev/null',
        15000, true);
      if (modules.code !== 0)
        return { ready: false, active: false, missing: [] as string[], report: '',
          reason: 'Ubuntu 客户机缺少当前内核的配额模块；请安装 linux-modules-extra-$(uname -r)。' };
    }
    const state = await exec(`LC_ALL=C quotaon -p ${quote(directory)}`, 15000, true);
    const userLine = /^user quota on .* is (on|off)$/m.exec(state.stdout);
    const active = userLine?.[1] === 'on';
    const notEnabled = /no quota enabled/i.test(state.stderr);
    const report = active
      ? await exec(`LC_ALL=C repquota -u -p ${quote(directory)}`, 15000, true)
      : null;
    return { ready: (Boolean(userLine) || notEnabled) && (!active || report?.code === 0), active,
      missing: [] as string[], report: report?.stdout.trim().slice(0, 20000) || '',
      reason: userLine || notEnabled ? undefined : state.stderr.trim() || '无法读取客户机配额状态' };
  };
  const current = await inspect();
  if (readOnly)
    return { executed: false, projectId, directory, uid: options.uid,
      projectLimitMiB: volume.limitMiB, ...current };

  return machines.locked(vmId, async () => {
    const confirmed = await projectQuota(machines, workspaces, vmId, {}, 'check');
    if (!confirmed.ready || !confirmed.active || confirmed.directory !== directory)
      throw new AppError('项目配额卷状态已改变，请重新检查', 409);
    if (current.missing.length) throw new AppError(current.reason!, 409);
    if (!current.ready && current.reason) throw new AppError(current.reason, 409);
    const uid = options.uid;
    const exists = await exec(`awk -F: -v u=${uid} '$3 == u { found=1 } END { exit !found }' /etc/passwd`, 15000, true);
    if (options.mode === 'set' && exists.code !== 0)
      throw new AppError(`客户机用户 UID ${uid} 不存在`, 409);
    if (options.mode === 'set') {
      if (options.hardMiB >= (confirmed.limitMiB || 0))
        throw new AppError('用户上限必须小于项目目录配额上限', 409);
      if (machines.get(vmId).distro === 'ubuntu')
        await exec('modprobe quota_v2 && modprobe quota_tree');
      const tag = `# sakura-project-quota-${projectId}`;
      const fstab = `sed -i '/${tag}$/s/loop,nofail/loop,usrquota,nofail/' /etc/fstab`;
      await exec([
        'set -eu',
        fstab,
        `grep -F ${quote(tag)} /etc/fstab | grep -F 'usrquota' >/dev/null`,
        `mount -o remount,usrquota ${quote(directory)}`,
        `if [ ! -f ${quote(`${directory}/aquota.user`)} ]; then quotacheck -cum ${quote(directory)}; fi`,
        `LC_ALL=C quotaon -u ${quote(directory)} || ` +
          `LC_ALL=C quotaon -p ${quote(directory)} | grep -E '^user quota on .* is on$' >/dev/null`,
      ].join('\n'), 120000);
      if (machines.get(vmId).distro === 'alpine') {
        const hook = `/etc/local.d/sakura-project-quota-${projectId}.start`;
        await exec([
          'set -eu',
          'mkdir -p /etc/local.d',
          `printf '%s\\n' '#!/bin/sh' ${quote(`quotaon -u ${quote(directory)} >/dev/null 2>&1 || true`)} > ${quote(hook)}`,
          `chmod 700 ${quote(hook)}`,
          'rc-update add local default',
        ].join('\n'), 30000);
      }
      const blocks = options.hardMiB * 1024;
      await exec(`set -eu\nsetquota -u ${uid} ${blocks} ${blocks} 0 0 ${quote(directory)}`);
    } else {
      if (!current.active) throw new AppError('用户配额尚未启用', 409);
      await exec(`setquota -u ${uid} 0 0 0 0 ${quote(directory)}`);
    }
    const after = await inspect();
    if (!after.ready || !after.active)
      throw new AppError(`用户配额操作后校验失败：${JSON.stringify(after)}`, 409);
    return { ready: true, executed: true, projectId, directory, uid,
      hardMiB: options.mode === 'clear' ? 0 : options.hardMiB,
      active: true, report: after.report, reason: undefined };
  });
}
