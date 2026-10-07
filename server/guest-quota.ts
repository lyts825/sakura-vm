/**
 * 模块职责：配置客户机用户磁盘配额；执行前要求项目配额及挂载卷已准备就绪。
 * Module purpose: Configures guest user disk quotas after project quota and volume preparation are confirmed.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';

import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';
import { projectQuota } from './project-quota.ts';

export const guestQuotaShape = {
  mode: z.enum(['status', 'set', 'clear']).default('status'),
  uid: z.number().int().min(1).max(60000).default(1000),
  hardMiB: z.number().int().min(1).max(102400).default(256),
};
export const guestQuotaSchema = z.object(guestQuotaShape).strict();

/**
 * 入口 / Entry: guestQuota.
 * 功能：读取、应用或清除客户机用户配额，依赖已准备的项目配额及挂载卷。
 * Purpose: Reads/applies/clears guest user quota after project quota and mount preparation.
 * 设计：执行固定管理命令并检查实际回执；目录或配额状态未完成时拒绝继续变更。
 * Design: Fixed administration commands require actual receipts; unfinished directory/quota state blocks further changes.
 * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; vmId: string; input: unknown; action: 'check' | 'run'; signal: AbortSignal optional
 * 输出 / Returns: `{ ready: false, executed: false, active: false, projectId, report: '', reason: '请先为当前项目启用项目磁盘配额，并确保卷已挂载。' }`; `{ executed: false, projectId, directory, uid: options.uid, projectLimitMiB: volume.limitMiB, ...current }`; `machines.locked(vmId, async () => { const confirmed = await projectQuota(machines, workspaces, vmId, {}, 'check'); if (!confi…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function guestQuota(
  machines: Machines,
  workspaces: WorkspacesV1,
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
  /**
   * 入口 / Entry: guestQuota.exec.
   * 功能：在配置客户机用户磁盘配额中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`guest-quota.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `guest-quota.ts`; this entry produces `result` for its caller. Module context: Configures guest user disk quotas after project quota and volume preparation are confirmed.
   * 处理：通过 `signal.throwIfAborted`, `machines.exec`, `result.stderr.trim`, `result.stdout.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `machines.exec`, `result.stderr.trim`, `result.stdout.trim`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `readOnly`.
   * 输入 / Inputs: script: string; timeout: default=30000; tolerate: default=false
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0 && !tolerate`; 异常 / errors `new AppError(result.stderr.trim() || result.stdout.trim() || '客户机用户配额操作失败', 409)`.
   */
  const exec = async (script: string, timeout = 30000, tolerate = false) => {
    if (readOnly) signal?.throwIfAborted();
    const result = await machines.exec(vmId, script, timeout, readOnly ? signal : undefined);
    if (result.code !== 0 && !tolerate)
      throw new AppError(result.stderr.trim() || result.stdout.trim() || '客户机用户配额操作失败', 409);
    return result;
  };
  /**
   * 入口 / Entry: guestQuota.inspect.
   * 功能：在配置客户机用户磁盘配额中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ ready: false, active: false, missing, report: '', reason: `客户机缺少 ${missing.join('、')}；Alpine 安装 quota-tools，Debian/Ubuntu 安…` / `{ ready: false, active: false, missing: [] as string[], report: '', reason: 'Ubuntu 客户机缺少当前内核的配额模块；请安装 linux-modules-extra-$(…` 供上层消费（`guest-quota.ts`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `guest-quota.ts`; this entry produces `{ ready: false, active: false, missing, report: '', reason: `客户机缺少 ${missing.join('、')}；Alpine 安装 quota-tools，Debian/Ubuntu 安…` / `{ ready: false, active: false, missing: [] as string[], report: '', reason: 'Ubuntu 客户机缺少当前内核的配额模块；请安装 linux-modules-extra-$(…` for its caller. Module context: Configures guest user disk quotas after project quota and volume preparation are confirmed.
   * 处理：通过 `exec`, `tools.stdout.trim().split().filter`, `tools.stdout.trim().split`, `tools.stdout.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `exec`, `tools.stdout.trim().split().filter`, `tools.stdout.trim().split`, `tools.stdout.trim`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `missing.length`; `machines.get(vmId).distro === 'ubuntu'`; `modules.code !== 0`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ ready: false, active: false, missing, report: '', reason: `客户机缺少 ${missing.join('、')}；Alpine 安装 quota-tools，Debian/Ubuntu 安…`; `{ ready: false, active: false, missing: [] as string[], report: '', reason: 'Ubuntu 客户机缺少当前内核的配额模块；请安装 linux-modules-extra-$(…`; `{ ready: (Boolean(userLine) || notEnabled) && (!active || report?.code === 0), active, missing: [] as string[], report: repor…`.
   * 副作用 / Effects: `exec`; `inline.exec`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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

  /**
   * 入口 / Entry: guestQuota.callback@72.
   * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（machines.locked）。
   * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (machines.locked).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ ready: true, executed: true, projectId, directory, uid, hardMiB: options.mode === 'clear' ? 0 : options.hardMiB, active: tr…`.
   * 副作用 / Effects: `exec`.
   * 拒绝 / Refusals: 条件 / conditions `!confirmed.ready || !confirmed.active || confirmed.directory !== directory`; `current.missing.length`; `!current.ready && current.reason`; 异常 / errors `new AppError('项目配额卷状态已改变，请重新检查', 409)`; `new AppError(current.reason!, 409)`.
   */
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
