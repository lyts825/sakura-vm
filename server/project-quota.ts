import { randomBytes } from 'node:crypto';
import { readFile, rm, rename, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { AppError, vmDir } from './model.ts';
import { quote } from './files.ts';

export const projectQuotaShape = {
  mode: z.enum(['status', 'apply', 'grow', 'clear']).default('status'),
  limitMiB: z.number().int().min(64).max(102400).default(512),
};
export const projectQuotaSchema = z.object(projectQuotaShape).strict();

const recordSchema = z.object({
  directory: z.string(),
  limitMiB: z.number().int(),
  backup: z.string(),
  phase: z.enum(['preparing', 'active']),
}).strict();
type Record = z.infer<typeof recordSchema>;

const root = '/var/lib/sakura/project-quotas';
const image = (projectId: string) => `${root}/${projectId}.img`;
const stage = (projectId: string) => `${root}/${projectId}.stage`;
const marker = (projectId: string) => `# sakura-project-quota-${projectId}`;
const recordFile = (vmId: string, projectId: string) =>
  join(vmDir(vmId), `project-quota-${projectId}.json`);

export async function readProjectQuotaRecord(vmId: string, projectId: string): Promise<Record | null> {
  try {
    return recordSchema.parse(JSON.parse(await readFile(recordFile(vmId, projectId), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function saveRecord(vmId: string, projectId: string, record: Record) {
  const file = recordFile(vmId, projectId);
  await writeFile(`${file}.tmp`, JSON.stringify(record, null, 2));
  await rename(`${file}.tmp`, file);
}

export async function guardProjectQuotaDirectory(
  vmId: string, projectId: string, next: string, otherProjectIds: string[] = [],
) {
  const record = await readProjectQuotaRecord(vmId, projectId);
  if (record && record.directory !== next)
    throw new AppError('项目配额生效或恢复中；请先在项目磁盘配额中清除配额，再修改目录', 409);
  for (const otherId of otherProjectIds) {
    if (otherId === projectId) continue;
    const other = await readProjectQuotaRecord(vmId, otherId);
    if (other && (other.directory === next || other.directory.startsWith(next + '/') || next.startsWith(other.directory + '/')))
      throw new AppError('项目目录与另一个受配额保护的项目重叠；请使用独立目录', 409);
  }
}

function directoryAllowed(directory: string) {
  return (directory === '/workspace' || /^\/workspace\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(directory)) &&
    posix.normalize(directory) === directory && !directory.split('/').includes('..') &&
    !directory.startsWith('/workspace/.sakura-');
}

export async function projectQuota(
  machines: Machines,
  workspaces: Workspaces,
  vmId: string,
  input: unknown,
  action: 'check' | 'run',
  signal?: AbortSignal,
) {
  const options = projectQuotaSchema.parse(input);
  const projectId = workspaces.projects.current(vmId);
  const directory = (await workspaces.config(vmId)).directory;
  if (!directoryAllowed(directory))
    return { ready: false, executed: false, active: false, persistent: false,
      reason: '项目配额要求项目目录位于 /workspace，且路径仅含字母、数字、点、下划线或连字符。' };
  if (machines.state(vmId) !== 'running')
    return { ready: false, executed: false, active: false, persistent: false,
      reason: '请先启动发行版。' };

  const readOnly = action === 'check' || options.mode === 'status';
  const exec = async (script: string, timeout = 30000, tolerate = false) => {
    if (readOnly) signal?.throwIfAborted();
    const result = await machines.exec(vmId, script, timeout, readOnly ? signal : undefined);
    if (result.code !== 0 && !tolerate)
      throw new AppError(result.stderr.trim() || result.stdout.trim() || '项目配额操作失败', 409);
    return result;
  };
  const inspect = async () => {
    const result = await exec(
      `awk -v p=${quote(directory)} '$2 == p {print $1 " " $3}' /proc/mounts; ` +
      `df -Pk ${quote(directory)} | tail -n 1; ` +
      `grep -F ${quote(marker(projectId))} /etc/fstab || true; ` +
      `for f in /sys/block/loop*/loop/backing_file; do [ -f "$f" ] || continue; ` +
      `printf '%s ' "$f"; cat "$f"; done`,
      15000,
    );
    const lines = result.stdout.trim().split(/\r?\n/);
    const mount = lines.find((line) => /^\/dev\/loop\d+ ext[234]$/.test(line));
    const filesystem = lines.find((line) => /^\S+\s+\d+\s+\d+\s+\d+\s+\d+%\s+/.test(line));
    const fstab = lines.some((line) => line.includes(marker(projectId)));
    const backing = mount && lines.some((line) => line.startsWith(
      `/sys/block/${mount.split(' ')[0].split('/').at(-1)}/loop/backing_file `) &&
      line.endsWith(image(projectId)));
    const fields = filesystem?.trim().split(/\s+/);
    return {
      active: Boolean(mount && backing), persistent: fstab,
      mount: mount || null,
      capacityMiB: fields ? Math.round(Number(fields[1]) / 1024) : null,
      usedMiB: fields ? Math.round(Number(fields[2]) / 1024) : null,
      availableMiB: fields ? Math.round(Number(fields[3]) / 1024) : null,
    };
  };
  const currentRecord = await readProjectQuotaRecord(vmId, projectId);
  const current = await inspect();
  if (readOnly)
    return {
      ready: currentRecord
        ? currentRecord.phase === 'active' && current.active && current.persistent
        : !current.active && !current.persistent,
      executed: false, projectId, directory, limitMiB: currentRecord?.limitMiB || null,
      phase: currentRecord?.phase || 'none', ...current,
      ...(currentRecord && !current.active
        ? { reason: '记录存在，但配额未挂载；底层目录已禁止写入，请先修复客户机挂载。' }
        : !currentRecord && (current.active || current.persistent)
          ? { reason: '客户机存在未登记的配额挂载或开机挂载项，请先人工检查。' }
          : {}),
    };

  return machines.locked(vmId, async () => {
    const record = await readProjectQuotaRecord(vmId, projectId);
    const before = await inspect();
    const requireStoppedProject = async () => {
      if (workspaces.jobs.view(workspaces.projects.key(vmId))?.status === 'running')
        throw new AppError('请等待项目操作完成', 409);
      const sessions = await exec(`if command -v tmux >/dev/null; then tmux list-sessions -F '#{session_name}' 2>/dev/null || true; fi`);
      const sessionPrefix = projectId === 'default' ? 'sakura-project' : `sakura-project-${projectId}`;
      const servicePrefix = projectId === 'default' ? 'sakura-service-' : `sakura-service-${projectId}-`;
      if (sessions.stdout.split(/\r?\n/).some((name) => name === sessionPrefix || name.startsWith(servicePrefix)))
        throw new AppError('请先停止当前项目服务', 409);
    };
    if (options.mode === 'apply') {
      if (record || before.active || before.persistent)
        throw new AppError('项目已有配额或遗留状态；请先检查或清除', 409);
      const index = await workspaces.projects.list(vmId);
      for (const other of index.projects) {
        if (other.id === projectId) continue;
        const otherDirectory = await workspaces.projects.inScope(vmId, other.id, async () =>
          (await workspaces.config(vmId)).directory);
        if (otherDirectory === directory || otherDirectory.startsWith(directory + '/') || directory.startsWith(otherDirectory + '/'))
          throw new AppError(`项目“${other.name}”使用重叠目录；请先为项目设置独立目录`, 409);
      }
      await requireStoppedProject();
      const backup = `${root}/backup-${projectId}-${randomBytes(6).toString('hex')}`;
      const next: Record = { directory, limitMiB: options.limitMiB, backup, phase: 'preparing' };
      const source = quote(directory), staged = quote(stage(projectId)), disk = quote(image(projectId));
      await exec(`mkdir -p ${quote(root)}\ntest ! -e ${disk} && test ! -e ${staged} && test ! -e ${quote(backup)}`);
      await saveRecord(vmId, projectId, next);
      const prepare = [
        'set -eu',
        `mkdir -p ${source} ${quote(root)}`,
        `test "$(realpath -e ${source})" = ${source} || { echo '项目目录包含符号链接' >&2; exit 1; }`,
        `if awk -v p=${source} '$2 == p || index($2, p "/") == 1 {found=1} END {exit !found}' /proc/mounts; then echo '项目目录已有挂载' >&2; exit 1; fi`,
        `test ! -e ${disk} && test ! -e ${staged} && test ! -e ${quote(backup)}`,
        'command -v mkfs.ext4 >/dev/null && command -v chattr >/dev/null && command -v losetup >/dev/null',
        `truncate -s ${options.limitMiB}M ${disk}`,
        `mkfs.ext4 -F -q ${disk}`,
        `mkdir ${staged}`,
        `mount -o loop ${disk} ${staged}`,
        `cp -a ${source}/. ${staged}/`,
        `chown "$(stat -c %u:%g ${source})" ${staged}`,
        `chmod "$(stat -c %a ${source})" ${staged}`,
        'sync',
        `umount ${staged}`,
        `rmdir ${staged}`,
      ].join('\n');
      try {
        await exec(prepare, 300000);
      } catch (error) {
        const clean = await exec([
          'set -eu',
          `if awk -v p=${staged} '$2 == p {found=1} END {exit !found}' /proc/mounts; then umount ${staged}; fi`,
          `rm -rf ${staged}`,
          `rm -f ${disk}`,
        ].join('\n'), 30000, true);
        if (clean.code === 0) await rm(recordFile(vmId, projectId), { force: true });
        throw error;
      }
      const entry = `${image(projectId)} ${directory} ext4 loop,nofail 0 0 ${marker(projectId)}`;
      try {
        await exec([
          'set -eu',
          `mv ${source} ${quote(backup)}`,
          `mkdir ${source}`,
          `chattr +i ${source}`,
          `mount -o loop ${disk} ${source}`,
          `printf '%s\\n' ${quote(entry)} >> /etc/fstab`,
        ].join('\n'), 60000);
        const after = await inspect();
        if (!after.active || !after.persistent) throw new AppError(`配额挂载校验失败：${JSON.stringify(after)}`, 409);
        await saveRecord(vmId, projectId, { ...next, phase: 'active' });
        return { ready: true, executed: true, projectId, directory, limitMiB: options.limitMiB,
          backup, ...after };
      } catch (error) {
        // Keep the preparation record if recovery is uncertain; it prevents a directory change.
        await exec([
          `sed '/${marker(projectId).replaceAll('/', '\\/')}$/d' /etc/fstab > /etc/fstab.sakura-quota-tmp && mv /etc/fstab.sakura-quota-tmp /etc/fstab`,
          `umount ${source} 2>/dev/null || true`,
          `chattr -i ${source} 2>/dev/null || true`,
          `rmdir ${source} 2>/dev/null || true`,
          `if [ -d ${quote(backup)} ] && [ ! -e ${source} ]; then mv ${quote(backup)} ${source}; fi`,
        ].join('\n'), 60000, true);
        const restored = await exec(`test -d ${source} && test ! -e ${quote(backup)} && ` +
          `! awk -v p=${source} '$2 == p {found=1} END {exit !found}' /proc/mounts && ` +
          `! grep -Fq ${quote(marker(projectId))} /etc/fstab`, 15000, true);
        if (restored.code === 0) {
          await exec(`rm -f ${disk}`);
          await rm(recordFile(vmId, projectId), { force: true });
        }
        throw error;
      }
    }
    if (!record || record.phase !== 'active' || !before.active || !before.persistent)
      throw new AppError('项目配额未处于完整挂载状态；请先检查配额', 409);
    if (record.directory !== directory) throw new AppError('项目目录与配额记录不一致', 409);
    if (options.mode === 'grow') {
      if (options.limitMiB <= record.limitMiB) throw new AppError('扩容后的上限必须高于当前上限', 409);
      const loop = before.mount!.split(' ')[0];
      await exec(`set -eu\ntruncate -s ${options.limitMiB}M ${quote(image(projectId))}\nlosetup -c ${quote(loop)}\nresize2fs ${quote(loop)}`, 120000);
      await saveRecord(vmId, projectId, { ...record, limitMiB: options.limitMiB });
      return { ready: true, executed: true, projectId, directory, limitMiB: options.limitMiB, ...await inspect() };
    }
    if (options.mode === 'clear') {
      await requireStoppedProject();
      const staged = quote(stage(projectId)), source = quote(directory);
      await exec(`test ! -e ${staged}`);
      try {
        await exec([
          'set -eu',
          `mkdir ${staged}`,
          `cp -a ${source}/. ${staged}/`,
          `chown "$(stat -c %u:%g ${source})" ${staged}`,
          `chmod "$(stat -c %a ${source})" ${staged}`,
          'sync',
        ].join('\n'), 300000);
      } catch (error) {
        await exec(`rm -rf ${staged}`, 30000, true);
        throw error;
      }
      const savedEntry = `${image(projectId)} ${directory} ext4 loop,nofail 0 0 ${marker(projectId)}`;
      try {
        await exec([
          'set -eu',
          `sed '/${marker(projectId).replaceAll('/', '\\/')}$/d' /etc/fstab > /etc/fstab.sakura-quota-tmp`,
          `mv /etc/fstab.sakura-quota-tmp /etc/fstab`,
          `if ! umount ${source}; then printf '%s\\n' ${quote(savedEntry)} >> /etc/fstab; exit 1; fi`,
          `chattr -i ${source}`,
          `rmdir ${source}`,
          `mv ${staged} ${source}`,
          `mv ${quote(image(projectId))} ${quote(`${root}/archive-${projectId}-${randomBytes(6).toString('hex')}.img`)}`,
        ].join('\n'), 60000);
        await rm(recordFile(vmId, projectId), { force: true });
        return { ready: true, executed: true, projectId, directory, active: false, persistent: false,
          reason: '已保留原始目录备份与配额镜像归档，项目内容已迁回普通目录。' };
      } catch (error) {
        const state = await inspect();
        if (state.active && state.persistent) await exec(`rm -rf ${staged}`, 30000, true);
        throw new AppError(`清除未完成；原配额数据仍保留，请检查挂载与 ${stage(projectId)}：${(error as Error).message}`, 409);
      }
    }
    throw new AppError('未知项目配额操作');
  });
}
