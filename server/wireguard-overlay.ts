import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError, vmDir } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import { redactValues, secretName, type Secrets } from './secrets.ts';

const interfaceName = 'wg-sakura';
const key = z.string().regex(/^[A-Za-z0-9+/]{43}=$/).refine((value) =>
  Buffer.from(value, 'base64').length === 32);
const cidr = z.string().max(50).refine((value) => {
  const [address, length, extra] = value.split('/');
  const version = isIP(address);
  return !extra && !!version && /^(0|[1-9][0-9]*)$/.test(length || '') &&
    Number(length) <= (version === 4 ? 32 : 128);
}, '需要 IPv4/IPv6 CIDR');
const endpoint = z.string().max(260).refine((value) => {
  try {
    const url = new URL(`udp://${value}`);
    return !!url.hostname && Number(url.port) >= 1 && Number(url.port) <= 65535 &&
      !url.username && !url.password && (url.pathname === '/' || url.pathname === '') &&
      !url.search && !url.hash &&
      !/\s/.test(value);
  } catch { return false; }
}, '需要主机名或 IP 及 UDP 端口');
export const wireGuardConfigSchema = z.object({
  address: cidr,
  listenPort: z.number().int().min(1).max(65535),
  privateKeySecret: secretName,
  peers: z.array(z.object({
    publicKey: key,
    endpoint: endpoint.optional(),
    allowedIPs: z.array(cidr).min(1).max(16),
    keepaliveSeconds: z.number().int().min(0).max(65535).default(0),
  }).strict()).min(1).max(8),
  enabled: z.boolean().default(false),
}).strict().superRefine((config, ctx) => {
  const keys = new Set<string>();
  const ranges = new Set<string>();
  for (const [index, peer] of config.peers.entries()) {
    if (keys.has(peer.publicKey))
      ctx.addIssue({ code: 'custom', path: ['peers', index, 'publicKey'], message: '同一公钥只能出现一次' });
    keys.add(peer.publicKey);
    for (const range of peer.allowedIPs) {
      if (range.endsWith('/0'))
        ctx.addIssue({ code: 'custom', path: ['peers', index, 'allowedIPs'],
          message: '覆盖网络不能接管默认路由' });
      if (ranges.has(range))
        ctx.addIssue({ code: 'custom', path: ['peers', index, 'allowedIPs'],
          message: '不同对端的允许网段不能重复' });
      ranges.add(range);
    }
  }
});
export const wireGuardInput = z.object({
  mode: z.enum(['status', 'generate-key', 'save', 'start', 'stop']).default('status'),
  config: z.object({
    address: wireGuardConfigSchema.shape.address,
    listenPort: wireGuardConfigSchema.shape.listenPort,
    privateKeySecret: wireGuardConfigSchema.shape.privateKeySecret,
    peers: wireGuardConfigSchema.shape.peers,
  }).strict().optional(),
  secret: secretName.optional(),
}).strict();

export function wireGuardPublicKey(privateKey: string) {
  key.parse(privateKey);
  const der = Buffer.concat([
    Buffer.from('302e020100300506032b656e04220420', 'hex'),
    Buffer.from(privateKey, 'base64'),
  ]);
  const privateObject = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const publicDer = createPublicKey(privateObject).export({ format: 'der', type: 'spki' });
  return Buffer.from(publicDer).subarray(-32).toString('base64');
}

export class WireGuardOverlay {
  private timer: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  private booted = new Map<string, object>();
  private failures = new Map<string, { at: number; reason: string }>();
  private abort = new AbortController();
  private closed = false;
  constructor(private machines: Machines, private secrets: () => Secrets | undefined) {
    this.timer = setInterval(() => {
      if (!this.ticking) this.ticking = this.tick().catch(() => {}).finally(() => {
        this.ticking = undefined;
      });
    }, 30_000);
    this.timer.unref();
  }
  private file(id: string) { return join(vmDir(id), 'wireguard-overlay.json'); }
  private async config(id: string) {
    return wireGuardConfigSchema.nullable().parse(await readStore(this.file(id), () => null));
  }
  private requireSecrets() {
    const secrets = this.secrets();
    if (!secrets) throw new AppError('请启用私密配置插件', 409);
    return secrets;
  }
  private async exec(id: string, command: string, signal: AbortSignal, timeout = 30_000) {
    const result = await this.machines.exec(id, command, timeout, signal);
    if (result.code) throw new AppError((result.stderr || result.stdout || '客户机命令失败').slice(0, 500), 409);
    return result.stdout.trim();
  }
  private async guestStatus(id: string, signal: AbortSignal) {
    if (this.machines.state(id) !== 'running') return { active: false, reason: '客户机未运行' };
    const result = await this.machines.exec(id,
      `if command -v wg >/dev/null 2>&1 && ip link show dev ${interfaceName} >/dev/null 2>&1; then ` +
      `printf 'active\\n'; wg show ${interfaceName} public-key; wg show ${interfaceName} latest-handshakes; ` +
      `else printf 'inactive\\n'; fi`, 15_000, signal);
    if (result.code) return { active: false, reason: result.stderr.slice(0, 500) };
    const lines = result.stdout.trim().split(/\r?\n/);
    return lines[0] === 'active'
      ? { active: true, publicKey: lines[1] || '', handshakes: lines.slice(2) }
      : { active: false };
  }
  private async install(id: string, signal: AbortSignal) {
    const found = await this.machines.exec(id, 'command -v wg >/dev/null && command -v ip >/dev/null',
      15_000, signal);
    if (!found.code) return;
    const distro = this.machines.get(id).distro || 'alpine';
    const command = distro === 'alpine' ? 'apk add --no-cache wireguard-tools' :
      'DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y wireguard-tools iproute2';
    await this.exec(id, command, signal, 180_000);
  }
  private async withGuestConfig<T>(id: string, content: string, signal: AbortSignal,
    work: (path: string) => Promise<T>) {
    const path = `/run/sakura-wireguard-${randomUUID()}.conf`;
    try {
      await this.machines.sftp(id, async (ftp, transport) => {
        await pipeline(Readable.from([Buffer.from(content)]),
          ftp.createWriteStream(path, { flags: 'wx', mode: 0o600 }),
          { signal: transport || signal });
      }, signal);
      return await work(path);
    } finally {
      try {
        await this.machines.sftp(id, (ftp) => new Promise<void>((resolve, reject) =>
          ftp.unlink(path, (error) => {
            const code = (error as Error & { code?: string | number } | undefined)?.code;
            error && code !== 2 && code !== 'ENOENT' ? reject(error) : resolve();
          })));
      } catch {
        const fallback = await this.machines.exec(id, `rm -f -- ${path}`, 10_000).catch(() => null);
        if (!fallback || fallback.code)
          throw new AppError('无法确认客户机临时 WireGuard 密钥文件已清理', 500);
      }
    }
  }
  private async start(id: string, signal: AbortSignal) {
    return this.machines.locked(`wireguard:${id}`, async () => {
      this.machines.requireUnlocked(id);
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动客户机', 409);
      const config = await this.config(id);
      if (!config) throw new AppError('请先保存 WireGuard 覆盖网络配置', 409);
      const secret = await this.requireSecrets().value(id, config.privateKeySecret);
      key.parse(secret);
      const expectedPublicKey = wireGuardPublicKey(secret);
      const status = await this.guestStatus(id, signal);
      if (status.active) {
        if (status.publicKey !== expectedPublicKey)
          throw new AppError('同名 WireGuard 接口不属于当前配置', 409);
        if (!config.enabled) await writeStore(this.file(id), { ...config, enabled: true });
        this.booted.set(id, this.machines.live.get(id)!);
        return { ready: true, executed: false, config: { ...config, enabled: true }, status };
      }
      await this.install(id, signal);
      const lines = ['[Interface]', `PrivateKey = ${secret}`, `ListenPort = ${config.listenPort}`];
      for (const peer of config.peers) lines.push('', '[Peer]', `PublicKey = ${peer.publicKey}`,
        `AllowedIPs = ${peer.allowedIPs.join(', ')}`,
        ...(peer.endpoint ? [`Endpoint = ${peer.endpoint}`] : []),
        ...(peer.keepaliveSeconds ? [`PersistentKeepalive = ${peer.keepaliveSeconds}`] : []));
      await this.withGuestConfig(id, lines.join('\n') + '\n', signal, async (path) => {
        const routes = config.peers.flatMap((peer) => peer.allowedIPs);
        const command = `set -e\n` +
          `ip link add dev ${interfaceName} type wireguard\n` +
          `trap 'ip link del dev ${interfaceName} >/dev/null 2>&1 || true' EXIT\n` +
          `wg setconf ${interfaceName} ${path}\n` +
          `ip address add dev ${interfaceName} ${config.address}\n` +
          `ip link set up dev ${interfaceName}\n` +
          routes.map((range) => `ip ${isIP(range.split('/')[0]) === 6 ? '-6 ' : ''}route add ${range} dev ${interfaceName}`).join('\n') + '\n' +
          `trap - EXIT`;
        try { await this.exec(id, command, signal, 30_000); }
        catch (error) {
          throw new AppError(redactValues(String((error as Error).message || error), [secret]), 409);
        }
      });
      await writeStore(this.file(id), { ...config, enabled: true });
      this.booted.set(id, this.machines.live.get(id)!);
      this.failures.delete(id);
      return { ready: true, executed: true, config: { ...config, enabled: true },
        status: await this.guestStatus(id, signal) };
    });
  }
  async action(id: string, input: unknown, action: 'check' | 'run', signal: AbortSignal) {
    this.machines.get(id);
    const options = wireGuardInput.parse(input);
    const config = await this.config(id);
    if (action === 'check' && options.mode === 'save' && options.config) {
      const candidate = wireGuardConfigSchema.parse({ ...options.config, enabled: false });
      key.parse(await this.requireSecrets().value(id, candidate.privateKeySecret));
      return { ready: true, executed: false, config: candidate };
    }
    if (action === 'check' || options.mode === 'status') {
      const status = await this.guestStatus(id, signal);
      return { ready: !!config && status.active, executed: false, config, status,
        lastAutoError: this.failures.get(id)?.reason };
    }
    this.machines.requireUnlocked(id);
    if (options.mode === 'save') {
      if (!options.config) throw new AppError('请填写 WireGuard 配置', 400);
      return this.machines.locked(`wireguard:${id}`, async () => {
        if (this.machines.state(id) === 'running' && (await this.guestStatus(id, signal)).active)
          throw new AppError('请先停止现有 WireGuard 接口，再修改配置', 409);
        key.parse(await this.requireSecrets().value(id, options.config!.privateKeySecret));
        const saved = wireGuardConfigSchema.parse({ ...options.config, enabled: false });
        await writeStore(this.file(id), saved);
        this.booted.delete(id);
        this.failures.delete(id);
        return { ready: true, executed: true, config: saved };
      });
    }
    if (options.mode === 'generate-key') {
      if (!options.secret) throw new AppError('请指定保存私钥的私密配置名称', 400);
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动客户机', 409);
      return this.machines.locked(`wireguard:${id}`, async () => {
        const current = await this.config(id);
        if (current?.privateKeySecret === options.secret && (await this.guestStatus(id, signal)).active)
          throw new AppError('请先停止使用此密钥的 WireGuard 接口', 409);
        await this.install(id, signal);
        const secret = await this.exec(id, 'wg genkey', signal);
        key.parse(secret);
        await this.requireSecrets().save(id, { name: options.secret!, value: secret });
        return { ready: true, executed: true, secret: options.secret,
          publicKey: wireGuardPublicKey(secret) };
      });
    }
    if (options.mode === 'start') return this.start(id, signal);
    if (options.mode === 'stop') {
      return this.machines.locked(`wireguard:${id}`, async () => {
        const current = await this.config(id);
        if (!current) throw new AppError('没有已保存的 WireGuard 配置', 409);
        if (this.machines.state(id) === 'running') {
          const status = await this.guestStatus(id, signal);
          if (status.active) {
            const secret = await this.requireSecrets().value(id, current.privateKeySecret);
            if (status.publicKey !== wireGuardPublicKey(secret))
              throw new AppError('同名 WireGuard 接口不属于当前配置', 409);
          }
          await this.machines.exec(id, `ip link del dev ${interfaceName} 2>/dev/null || true`, 15_000, signal);
        }
        await writeStore(this.file(id), { ...current, enabled: false });
        this.booted.delete(id);
        this.failures.delete(id);
        return { ready: true, executed: true, status: { active: false } };
      });
    }
    throw new AppError('未知 WireGuard 操作', 400);
  }
  async tick() {
    if (this.closed || !this.secrets()) return;
    for (const id of this.machines.records.keys()) {
      if (this.closed || this.abort.signal.aborted) return;
      if (this.machines.state(id) !== 'running') continue;
      const live = this.machines.live.get(id);
      if (!live || this.booted.get(id) === live) continue;
      const failed = this.failures.get(id);
      if (failed && Date.now() - failed.at < 300_000) continue;
      try {
        if ((await this.config(id))?.enabled) await this.start(id, this.abort.signal);
      } catch (error) {
        this.failures.set(id, { at: Date.now(),
          reason: String((error as Error).message || error).slice(0, 500) });
      }
    }
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.abort.abort();
    await this.ticking;
  }
}
