import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { quote } from './files.ts';
import { readStore, regularDirectory, within, writeStore } from './local-store.ts';
import { serveHostMount } from './host-mount-sftp.ts';
import type { Machines } from './machines.ts';

const policySchema = z.object({
  enabled: z.boolean(),
  hostPath: z.string().min(1).max(1024),
  readOnly: z.boolean(),
}).strict();
type Policy = z.infer<typeof policySchema>;
export const hostMountRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('configure'), policy: policySchema }).strict(),
  z.object({ operation: z.literal('mount') }).strict(),
  z.object({ operation: z.literal('unmount') }).strict(),
]);

const GUEST_PATH = '/mnt/sakura-host';
const KEY_DIR = '/etc/sakura/host-mount';
type HostServer = Awaited<ReturnType<typeof serveHostMount>>;
type Active = { server: HostServer; hostPath: string; readOnly: boolean; boot: object };
type Observation = { at: string; mounted: boolean; error?: string };
const hostFile = () => join(DATA, 'host-mount.json');

export class HostMounts {
  private policies: Record<string, Policy> = {};
  private active = new Map<string, Active>();
  private observations = new Map<string, Observation>();
  private tasks = new Map<string, Promise<unknown>>();
  private writes = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private tick?: Promise<void>;
  private closed = false;
  constructor(private machines: Machines,
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {}) {}

  async init() {
    this.policies = z.record(z.uuid(), policySchema).parse(
      await readStore(hostFile(), () => ({})));
    this.timer = setInterval(() => {
      if (!this.tick && !this.closed)
        this.tick = this.reconcile().finally(() => { this.tick = undefined; });
    }, 10_000);
    this.timer.unref();
  }

  private locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tasks.get(id) || Promise.resolve();
    const task = previous.catch(() => {}).then(work);
    this.tasks.set(id, task);
    void task.finally(() => { if (this.tasks.get(id) === task) this.tasks.delete(id); })
      .catch(() => {});
    return task;
  }

  private async save(id: string, policy: Policy) {
    const operation = this.writes.catch(() => {}).then(async () => {
      const next = { ...this.policies, [id]: policy };
      await writeStore(hostFile(), next);
      this.policies = next;
    });
    this.writes = operation;
    await operation;
  }

  private async guestMountType(id: string) {
    const result = await this.machines.exec(id,
      `awk '$2=="${GUEST_PATH}" {print $3; exit}' /proc/mounts`, 10_000);
    if (result.code !== 0) throw new AppError('无法读取客户机挂载状态', 502);
    return result.stdout.trim();
  }

  private isActive(id: string) {
    const active = this.active.get(id);
    return !!active && this.machines.state(id) === 'running' &&
      active.boot === this.machines.live.get(id);
  }

  async view(id: string) {
    this.machines.get(id);
    const policy = this.policies[id] || { enabled: false, hostPath: '', readOnly: true };
    return { policy, guestPath: GUEST_PATH,
      running: this.machines.state(id) === 'running',
      mounted: this.isActive(id), observation: this.observations.get(id) || null };
  }

  async action(id: string, raw: unknown) {
    const input = hostMountRequest.parse(raw);
    if (this.closed) throw new AppError('服务正在关闭', 503);
    this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    this.mutation(1);
    try {
      await this.locked(id, async () => {
        if (input.operation === 'configure') {
          if (input.policy.enabled) {
            const hostPath = await regularDirectory(input.policy.hostPath);
            if (!(await lstat(hostPath).catch(() => null))?.isDirectory())
              throw new AppError('宿主共享目录不存在', 400);
            if (within(hostPath, DATA) || within(DATA, hostPath))
              throw new AppError('不能共享 Sakura 数据目录或其上级目录', 403);
            input.policy.hostPath = hostPath;
          }
          const old = this.policies[id];
          if (this.active.has(id) && (!input.policy.enabled ||
              old?.hostPath !== input.policy.hostPath ||
              old?.readOnly !== input.policy.readOnly)) await this.unmount(id);
          await this.save(id, input.policy);
          if (input.policy.enabled && this.machines.state(id) === 'running')
            await this.mount(id);
        } else if (input.operation === 'mount') {
          if (!this.policies[id]?.enabled) throw new AppError('请先启用宿主目录挂载策略', 409);
          await this.mount(id);
        } else {
          await this.unmount(id);
          if (this.policies[id]) await this.save(id, { ...this.policies[id], enabled: false });
        }
      }).catch((error) => {
        this.observations.set(id, { at: new Date().toISOString(), mounted: this.isActive(id),
          error: (error as Error).message });
        throw error;
      });
      return this.view(id);
    } finally { this.mutation(-1); }
  }

  private async mount(id: string) {
    if (this.isActive(id)) return;
    const stale = this.active.get(id);
    if (stale) {
      this.active.delete(id);
      await stale.server.close();
    }
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
    const policy = this.policies[id];
    if (!policy?.enabled) throw new AppError('未启用宿主目录挂载', 409);
    const hostPath = await regularDirectory(policy.hostPath);
    if (within(hostPath, DATA) || within(DATA, hostPath))
      throw new AppError('不能共享 Sakura 数据目录或其上级目录', 403);
    const server = await serveHostMount(hostPath, policy.readOnly);
    try {
      const currentType = await this.guestMountType(id);
      if (currentType && currentType !== 'fuse.sshfs')
        throw new AppError(`${GUEST_PATH} 已挂载其他文件系统`, 409);
      if (currentType === 'fuse.sshfs') {
        const unmounted = await this.machines.exec(id, `umount -l ${quote(GUEST_PATH)}`, 15_000);
        if (unmounted.code !== 0) throw new AppError(unmounted.stderr || '旧共享目录卸载失败', 409);
      }
      const distro = this.machines.get(id).distro || 'alpine';
      const install = distro === 'alpine'
        ? 'apk add --no-cache sshfs'
        : 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sshfs';
      const prepared = await this.machines.exec(id,
        `command -v sshfs >/dev/null || (${install}); modprobe fuse 2>/dev/null || true; test -c /dev/fuse; mkdir -p ${quote(KEY_DIR)} ${quote(GUEST_PATH)}; chmod 700 ${quote(KEY_DIR)}`,
        180_000);
      if (prepared.code !== 0)
        throw new AppError(prepared.stderr || '客户机安装 SSHFS/FUSE 失败', 502);
      const knownHosts = `[10.0.2.2]:${server.port} ${server.hostPublic.trim()}\n`;
      await this.machines.writeGuestFile(id, `${KEY_DIR}/id_ed25519`, server.clientPrivate);
      await this.machines.writeGuestFile(id, `${KEY_DIR}/known_hosts`, knownHosts);
      const secured = await this.machines.exec(id,
        `chmod 600 ${quote(KEY_DIR)}/id_ed25519 ${quote(KEY_DIR)}/known_hosts`, 10_000);
      if (secured.code !== 0) throw new AppError('客户机挂载密钥权限设置失败', 502);
      const command = `sshfs sakura-host@10.0.2.2:/ ${quote(GUEST_PATH)} -p ${server.port}` +
        ` -o IdentityFile=${KEY_DIR}/id_ed25519,UserKnownHostsFile=${KEY_DIR}/known_hosts,` +
        `StrictHostKeyChecking=yes,PasswordAuthentication=no,IdentitiesOnly=yes,` +
        `ConnectTimeout=5,ServerAliveInterval=10,ServerAliveCountMax=1` +
        (policy.readOnly ? ',ro' : '');
      const result = await this.machines.exec(id, command, 45_000);
      if (result.code !== 0) throw new AppError(result.stderr || 'SSHFS 挂载失败', 502);
      if (await this.guestMountType(id) !== 'fuse.sshfs')
        throw new AppError('客户机未确认 SSHFS 挂载', 502);
      this.active.set(id, { server, hostPath, readOnly: policy.readOnly,
        boot: this.machines.live.get(id)! });
      this.observations.set(id, { at: new Date().toISOString(), mounted: true });
    } catch (error) {
      await server.close();
      this.observations.set(id, { at: new Date().toISOString(), mounted: false,
        error: (error as Error).message });
      throw error;
    }
  }

  private async unmount(id: string) {
    const active = this.active.get(id);
    if (this.machines.state(id) === 'running') {
      const currentType = await this.guestMountType(id);
      if (currentType === 'fuse.sshfs') {
        const result = await this.machines.exec(id, `umount -l ${quote(GUEST_PATH)}`, 15_000);
        if (result.code !== 0) throw new AppError(result.stderr || 'SSHFS 卸载失败', 502);
      }
    }
    this.active.delete(id);
    await active?.server.close();
    this.observations.set(id, { at: new Date().toISOString(), mounted: false });
  }

  private async reconcile() {
    if (this.blocked()) return;
    for (const [id, active] of this.active) {
      if (this.closed) return;
      const sameBoot = active.boot === this.machines.live.get(id);
      const running = this.machines.state(id) === 'running';
      if (!sameBoot || !running ||
          await this.guestMountType(id).catch(() => '') !== 'fuse.sshfs') {
        await this.locked(id, async () => {
          if (this.active.get(id) !== active) return;
          this.active.delete(id);
          await active.server.close();
          this.observations.set(id, { at: new Date().toISOString(), mounted: false,
            error: sameBoot && running ? '客户机共享目录已断开，等待重试' : undefined });
        }).catch(() => {});
      }
    }
    for (const [id, policy] of Object.entries(this.policies)) {
      if (this.closed) return;
      if (!policy.enabled || !this.machines.records.has(id) ||
        this.machines.state(id) !== 'running' || this.isActive(id) || this.tasks.has(id)) continue;
      const observed = this.observations.get(id);
      if (observed?.error && Date.now() - Date.parse(observed.at) < 60_000) continue;
      await this.locked(id, () => this.mount(id)).catch(() => {});
    }
  }

  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.tick;
    await Promise.allSettled([...this.tasks.values()]);
    await this.writes;
    for (const active of this.active.values()) await active.server.close();
    this.active.clear();
  }
}
