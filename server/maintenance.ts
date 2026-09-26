import { stat, statfs, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { DATA, AppError } from './model.ts';
import type { Machines } from './machines.ts';
import { distributions } from './images.ts';
import { Jobs } from './jobs.ts';
import { guestTask } from './guest-task.ts';
import {
  diskMaintenanceDue,
  diskMaintenanceState,
  runDiskMaintenance,
  saveDiskMaintenancePolicy,
  type DiskOperation,
} from './disk-maintenance.ts';
import { inMaintenance } from './automation-policy.ts';
import { backupBlocks } from './backup-blocks.ts';

export type DiagnosticCheck = {
  name: string;
  status: 'ok' | 'warning' | 'error' | 'skip';
  detail: string;
  suggestion?: string;
};
export function redact(text: string) {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[密钥已隐藏]')
    .replace(
      /(["']?(?:token|password|secret|authorization|api[_-]?key)["']?\s*[:=]\s*)(["'])(.*?)\2/gi,
      '$1[已隐藏]',
    )
    .replace(/(authorization["'\s:=]+)(?:Bearer|Basic)\s+[^\s,"']+/gi, '$1[已隐藏]')
    .replace(/(token|password|secret|authorization|api[_-]?key)(["'\s:=]+)[^\s,"']+/gi, '$1$2[已隐藏]')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://[凭证已隐藏]@')
    .replace(/[A-Za-z]:[\\/][^\r\n"<>]+/g, '[本机路径已隐藏]');
}
export function hostPortIssue(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => resolve(error.code || error.message));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close((error) => resolve(error ? error.message : null));
    });
  });
}
export const growFilesystem = String.raw`set -eu
root=$(awk '$2=="/" { print $1; exit }' /proc/mounts)
root=$(readlink -f "$root")
case "$root" in /dev/vda) part='';; /dev/vda[0-9]*) part=$(cat /sys/class/block/$(basename "$root")/partition);; *) echo '当前根分区布局不支持自动扩容' >&2; exit 1;; esac
kind=$(awk '$2=="/" { print $3; exit }' /proc/mounts)
case "$kind" in ext4|ext3|ext2) ;; *) echo '当前文件系统不支持自动扩容' >&2; exit 1;; esac
if command -v apk >/dev/null; then apk add --no-cache --timeout 30 cloud-utils-growpart e2fsprogs-extra; else export DEBIAN_FRONTEND=noninteractive; apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update; apt-get -y install cloud-guest-utils e2fsprogs; fi
if [ -n "$part" ]; then
  output=$(growpart /dev/vda "$part" 2>&1) || { echo "$output"; echo "$output" | grep -q NOCHANGE || exit 1; }
  echo "$output"
fi
resize2fs "$root"
df -h /
disk_sectors=$(cat /sys/class/block/vda/size)
root_kib=$(df -Pk / | awk 'NR==2 { print $2 }')
[ "$root_kib" -gt $((disk_sectors * 512 / 1024 * 80 / 100)) ] || { echo '文件系统容量尚未达到磁盘容量的 80%，请检查分区布局' >&2; exit 1; }`;
export class Maintenance {
  jobs = new Jobs('maintenance');
  private reports = new Map<string, { createdAt: string; checks: DiagnosticCheck[]; log: string }>();
  private onChange = () => {
    for (const vm of this.machines.records.values()) {
      if (vm.pendingResize && this.machines.state(vm.id) === 'running' && !this.resizeAttempted.has(vm.id)) {
        this.resizeAttempted.add(vm.id);
        this.finishResize(vm.id);
      }
      if (!this.machines.live.has(vm.id)) this.resizeAttempted.delete(vm.id);
    }
  };
  private resizeAttempted = new Set<string>();
  private closed = false;
  private ticking?: Promise<void>;
  private timer: ReturnType<typeof setInterval>;
  constructor(private machines: Machines) {
    machines.on('change', this.onChange);
    this.timer = setInterval(() => {
      void this.tick().catch(() => {});
    }, 60000);
    this.timer.unref();
  }
  async storage() {
    const filesystem = await statfs(DATA);
    const images = await Promise.all(
      Object.entries(distributions).map(async ([id, info]) => ({
        id,
        name: info.name,
        bytes: (await stat(info.file).catch(() => null))?.size || 0,
      })),
    );
    const machines = await this.machines.list();
    const backupRoot = join(DATA, 'backups');
    let backupBytes = 0;
    for (const dir of await readdir(backupRoot, { withFileTypes: true }).catch(() => [])) {
      if (!dir.isDirectory() || !/^[0-9a-f-]{36}$/.test(dir.name)) continue;
      for (const file of await readdir(join(backupRoot, dir.name), { withFileTypes: true }))
        if (file.isFile() && /\.sakura(?:\.enc)?$/.test(file.name))
          backupBytes += (await stat(join(backupRoot, dir.name, file.name))).size;
    }
    return {
      total: filesystem.blocks * filesystem.bsize,
      available: filesystem.bavail * filesystem.bsize,
      images,
      backupBytes,
      deduplicatedBackups: await backupBlocks().inspect(),
      machines: machines.map((v) => ({
        id: v.id,
        name: v.name,
        bytes: v.diskBytes,
        capacity: v.diskGiB,
        snapshots: v.snapshots.length,
        pendingResize: !!v.pendingResize,
      })),
      warning: filesystem.bavail / filesystem.blocks < 0.1 ? 'Sakura 所在磁盘剩余空间不足 10%' : '',
    };
  }
  compact(id: string) {
    this.machines.requireStopped(id);
    return this.diskRun(id, 'compact');
  }
  async diskView(id: string) {
    this.machines.get(id);
    return {
      ...(await diskMaintenanceState(id)),
      job: this.jobs.view(id),
      maintenance: await inMaintenance(id),
    };
  }
  diskPolicy(id: string, input: unknown) {
    if (this.jobs.view(id)?.status === 'running') throw new AppError('请等待磁盘维护任务完成', 409);
    return saveDiskMaintenancePolicy(this.machines, id, input);
  }
  diskRun(id: string, operation: DiskOperation) {
    this.machines.get(id);
    this.machines.requireUnlocked(id);
    return this.jobs.start(
      id,
      async (log, signal, update, saveResult) => {
        await saveResult(await runDiskMaintenance(this.machines, id, operation, signal, log, update));
      },
      { title: operation === 'trim' ? '回收 Linux 未使用块' : '压缩与整理磁盘', vmId: id, action: operation },
    );
  }
  tick(now = Date.now()): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.ticking) return this.ticking;
    this.ticking = (async () => {
      for (const vm of this.machines.records.values()) {
        if (this.closed) break;
        if (this.jobs.view(vm.id)?.status === 'running' || this.machines.isBusy(vm.id)) continue;
        try {
          if (await inMaintenance(vm.id, now)) continue;
          const state = await diskMaintenanceState(vm.id),
            operation = diskMaintenanceDue(state, this.machines.state(vm.id), now);
          if (!operation || (operation === 'compact' && (vm.snapshots.length || vm.pendingResize))) continue;
          this.diskRun(vm.id, operation);
        } catch {
          /* Failed jobs retain their error; unavailable/locked VMs wait for the next tick. */
        }
      }
    })().finally(() => {
      this.ticking = undefined;
    });
    return this.ticking;
  }
  report(id: string) {
    this.machines.get(id);
    return this.reports.get(id) || null;
  }
  diagnose(id: string) {
    const vm = this.machines.get(id);
    return this.jobs.start(
      id,
      async (log, signal) => {
        const checks: DiagnosticCheck[] = [];
        const add = (check: DiagnosticCheck) => {
          checks.push(check);
          log(`${check.name}：${check.detail}${check.suggestion ? `；${check.suggestion}` : ''}\n`);
        };
        add({
          name: '虚拟化加速',
          status: this.machines.engine.whpxAvailable ? 'ok' : 'warning',
          detail: this.machines.engine.whpxAvailable ? 'WHPX 可用' : '当前使用兼容模式',
          suggestion: this.machines.engine.whpxAvailable
            ? undefined
            : '可在 Windows 可选功能启用 Windows Hypervisor Platform 后重启系统',
        });
        const space = await statfs(DATA);
        add({
          name: '主机磁盘空间',
          status: space.bavail / space.blocks < 0.1 ? 'warning' : 'ok',
          detail: `剩余 ${((space.bavail * space.bsize) / 1024 ** 3).toFixed(1)} GiB`,
          suggestion: space.bavail / space.blocks < 0.1 ? '清理不再需要的备份或实例' : undefined,
        });
        if (this.machines.state(id) !== 'running')
          add({
            name: 'Linux 检查',
            status: 'skip',
            detail: '启动实例后可检查 SSH、DNS、HTTPS 与 Linux 磁盘',
          });
        else {
          const commands = [
            ['SSH', 'printf connected', '请检查启动日志，停止后重新启动实例'],
            ['DNS', 'getent hosts example.com', '检查主机网络、VPN 和 Linux 的 /etc/resolv.conf'],
            [
              'HTTPS',
              'if command -v curl >/dev/null; then curl -fsSIL --max-time 10 https://example.com >/dev/null; else wget -q --spider -T 10 https://example.com; fi',
              '检查代理、DNS、证书与系统时间',
            ],
            [
              'Linux 磁盘',
              "df -Pk / | awk 'NR==2 {print $5; if ($5+0 >= 90) exit 1}'",
              '清理项目缓存或在关机后扩容磁盘',
            ],
          ];
          for (const [name, command, suggestion] of commands) {
            signal.throwIfAborted();
            try {
              const result = await this.machines.exec(id, command, 15000, signal);
              add({
                name,
                status: result.code === 0 ? 'ok' : 'error',
                detail: result.code === 0 ? '检查通过' : redact((result.stderr || result.stdout).slice(-300)),
                suggestion: result.code ? suggestion : undefined,
              });
            } catch (error) {
              signal.throwIfAborted();
              add({ name, status: 'error', detail: redact((error as Error).message), suggestion });
            }
          }
        }
        for (const port of vm.forwards) {
          signal.throwIfAborted();
          const conflicts = [...this.machines.records.values()].filter(
            (other) =>
              other.id !== id &&
              this.machines.live.has(other.id) &&
              other.forwards.some((f) => f.host === port.host),
          );
          const hostIssue =
            !conflicts.length && !this.machines.live.has(id) ? await hostPortIssue(port.host) : null;
          add({
            name: `端口 ${port.host}`,
            status: conflicts.length || hostIssue ? 'error' : 'ok',
            detail: conflicts.length
              ? '被其他运行实例使用'
              : hostIssue
                ? `Windows 端口不可用（${redact(hostIssue)}）`
                : `转发到 Linux ${port.guest}`,
            suggestion:
              conflicts.length || hostIssue ? '关闭占用端口的程序或在服务面板修改 Windows 端口' : undefined,
          });
        }
        this.reports.set(id, {
          createdAt: new Date().toISOString(),
          checks,
          log: redact((this.machines.logs.get(id) || '').slice(-8192)),
        });
      },
      { title: '一键故障诊断', vmId: id, action: 'diagnose' },
    );
  }
  resize(id: string, size: number) {
    this.machines.get(id);
    this.machines.requireStopped(id);
    return this.jobs.start(
      id,
      async (log, signal) => {
        log('创建扩容前快照并扩大磁盘…\n');
        await this.machines.resize(id, size, signal);
        log('磁盘已扩大，下次启动会自动扩展 Linux 分区和文件系统。\n');
      },
      { title: '磁盘扩容', vmId: id },
    );
  }
  finishResize(id: string) {
    if (this.jobs.view(id)?.status === 'running') return;
    if (!this.machines.get(id).pendingResize) throw new AppError('没有待完成的文件系统扩容');
    return this.jobs.start(
      id,
      async (log, signal) => {
        const result = await guestTask(this.machines, id, growFilesystem, signal, log);
        if (result.code !== 0) throw new AppError(result.stderr || '文件系统扩容失败，可重试或手动扩容');
        await this.machines.completeResize(id);
        log('分区与文件系统扩容完成。\n');
      },
      { title: '扩展 Linux 文件系统', vmId: id, action: 'finish-resize' },
    );
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.machines.off('change', this.onChange);
    await this.ticking;
    await this.jobs.close();
  }
}
