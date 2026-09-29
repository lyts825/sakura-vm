import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { HostPeers } from './host-peers.ts';
import { qmp } from './qmp.ts';

export const liveMigrationInput = z.object({
  targetHostId: z.uuid().optional(),
}).strict();

type Score = Awaited<ReturnType<HostPeers['score']>>;
type Query = typeof qmp;

export async function planLiveMigration(machines: Machines,
  scoreHosts: (input: { cpus: number; memoryMiB: number }) => Promise<Score>,
  id: string, raw: unknown, signal?: AbortSignal, query: Query = qmp) {
  const vm = machines.get(id);
  const options = liveMigrationInput.safeParse(raw);
  const blockers: string[] = [];
  const steps = [
    '在目标主机创建相同体系结构、固件、CPU 和内存配置的暂停虚拟机',
    '在线复制并持续同步实例磁盘，校验目标基础镜像与源端脏块',
    '通过认证的迁移通道预复制内存与设备状态',
    '冻结源实例，完成剩余状态传输并取得唯一切换栅栏',
    '启动目标实例并验证客户机、磁盘与端口转发后释放源实例',
  ];
  if (!options.success)
    blockers.push('目标主机 ID 无效。');
  signal?.throwIfAborted();
  let score: Score | null = null;
  try { score = await scoreHosts({ cpus: vm.cpus, memoryMiB: vm.memoryMiB }); }
  catch (error) { blockers.push(`无法读取主机资源：${(error as Error).message}`); }
  const candidates = score?.candidates.filter((item) => item.source === 'peer')
    .map(({ id, name, eligible, reasons, status }) => ({ id, name, eligible,
      reasons, platform: status?.platform, arch: status?.arch })) || [];
  const local = score?.candidates.find((item) => item.source === 'local');
  const compatible = (item: NonNullable<Score>['candidates'][number]) =>
    item.eligible && !!item.status && !!local?.status &&
    item.status.platform === local.status.platform &&
    item.status.arch === local.status.arch;
  const target = options.data?.targetHostId
    ? score?.candidates.find((item) => item.source === 'peer' &&
        item.id === options.data.targetHostId)
    : score?.candidates.find((item) => item.source === 'peer' && compatible(item)) ||
      score?.candidates.find((item) => item.source === 'peer');
  if (!target && !options.data?.targetHostId)
    blockers.push('尚无已配对的目标主机。');
  if (options.data?.targetHostId && !target)
    blockers.push('目标主机未配对或已移除。');
  if (target && !target.eligible)
    blockers.push(...target.reasons.map((reason) => `目标主机：${reason}`));
  if (target?.status && local?.status &&
      (target.status.platform !== local.status.platform ||
       target.status.arch !== local.status.arch))
    blockers.push('目标主机平台或体系结构与源主机不一致。');
  let qemu: unknown = null;
  let migration: unknown = null;
  if (machines.state(id) !== 'running' || !machines.live.get(id)) {
    blockers.push('源实例必须处于运行且就绪的状态。');
  } else {
    const port = machines.live.get(id)!.qmpPort;
    try {
      signal?.throwIfAborted();
      const status = await query(port, 'query-status', undefined, 5000) as
        { status?: string; running?: boolean };
      if (status?.status !== 'running' || status.running !== true)
        blockers.push(`源 QEMU 当前状态为 ${status?.status || '未知'}，不能开始迁移。`);
      qemu = await query(port, 'query-version', undefined, 5000);
      migration = await query(port, 'query-migrate', undefined, 5000);
      const migrationStatus = (migration as { status?: string })?.status;
      if (migrationStatus && !['none', 'completed', 'failed', 'cancelled'].includes(migrationStatus))
        blockers.push(`源 QEMU 已存在迁移任务：${migrationStatus}。`);
    } catch (error) {
      signal?.throwIfAborted();
      blockers.push(`源 QMP 检查失败：${(error as Error).message}`);
    }
  }
  blockers.push('尚未实现目标侧暂停接收进程与经认证的 QEMU 迁移通道。');
  blockers.push('尚未实现磁盘脏块同步与目标镜像一致性校验。');
  blockers.push('尚未实现防止源和目标同时写入的切换栅栏。');
  return {
    ready: false, executed: false, planned: true, sourceVmId: id,
    targetHostId: target?.id || options.data?.targetHostId || null,
    checkedAt: new Date().toISOString(), qemu, migration,
    candidates, blockers, steps,
    reason: blockers[0],
    message: '这是只读迁移计划；不会传输磁盘、启动目标或停止源实例。',
  };
}
