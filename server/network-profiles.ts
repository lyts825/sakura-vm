import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { join, posix } from 'node:path';
import { z } from 'zod';
import { AppError, DATA, vmDir, type VMConfig } from './model.ts';
import type { Machines } from './machines.ts';
import { Files, ftpStat, quote, textVersion } from './files.ts';
import { envPrefix } from './project-services.ts';
import { readStore, writeStore } from './local-store.ts';
import { Jobs } from './jobs.ts';
import { guestTask } from './guest-task.ts';
import { dependencyDownloadsSchema } from './dependency-downloads.ts';

const networkUrl = z
  .string()
  .max(2048)
  .default('')
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        !/[\s\x00-\x1f]/.test(value)
      );
    } catch {
      return false;
    }
  }, '请输入不含凭证、查询参数的 HTTP(S) 地址');
const forwardsSchema = z
  .array(
    z
      .object({
        name: z.string().trim().max(40).optional(),
        host: z.number().int().min(1024).max(65535),
        guest: z.number().int().min(1).max(65535),
      })
      .strict(),
  )
  .max(12)
  .refine((values) => new Set(values.map((item) => item.host)).size === values.length, '主机端口不能重复');
const dnsDomain = z.string().trim().toLowerCase().max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, '请输入完整 DNS 域名')
  .refine((value) => !value.endsWith('.local') && !value.endsWith('.localhost'),
    '.local 和 .localhost 不作为单播私有 DNS 路由域名');
export const networkSchema = z
  .object({
    dnsServers: z
      .array(
        z.string().refine((value) => isIP(value) !== 0 && !value.includes('%'), 'DNS 需要 IPv4 或 IPv6 地址'),
      )
      .max(3)
      .refine((values) => new Set(values).size === values.length, 'DNS 地址不能重复')
      .default([]),
    dnsDomains: z.array(dnsDomain).max(8)
      .refine((values) => new Set(values).size === values.length, 'DNS 域名不能重复')
      .default([]),
    dnssec: z.enum(['inherit', 'yes', 'allow-downgrade', 'no']).default('inherit'),
    forwards: forwardsSchema.optional(),
    httpProxy: networkUrl,
    httpsProxy: networkUrl,
    noProxy: z
      .string()
      .max(2048)
      .regex(/^[A-Za-z0-9_.,:*\-\[\]/]*$/)
      .default('localhost,127.0.0.1,::1'),
    npmRegistry: networkUrl,
    pipIndex: networkUrl,
    apkMirror: networkUrl,
    aptMirror: networkUrl,
    aptSecurityMirror: networkUrl,
    dependencyDownloads: dependencyDownloadsSchema.optional(),
  })
  .strict();
export type NetworkProfile = z.infer<typeof networkSchema>;
export type NetworkChange = { path: string; before: string | null; after: string };
export type ForwardChange = { before: VMConfig['forwards']; after: VMConfig['forwards'] };
type NetworkState = {
  config: NetworkProfile;
  changes: NetworkChange[];
  forwards?: ForwardChange;
  dnsBackend?: 'resolved';
  resolverLink?: { before: string; after: string };
  appliedAt?: string;
};
const savedProfileSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(60),
    config: networkSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type SavedNetworkProfile = z.infer<typeof savedProfileSchema>;
const sameForwards = (left: VMConfig['forwards'], right: VMConfig['forwards']) =>
  JSON.stringify(left) === JSON.stringify(right);
const canonicalIp = (value: string) => (isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname : value);
export function networkEnvironment(value: NetworkProfile): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, setting] of [
    ['HTTP_PROXY', value.httpProxy],
    ['HTTPS_PROXY', value.httpsProxy],
    ['NO_PROXY', value.noProxy],
  ])
    if (setting) {
      values[name] = setting;
      values[name.toLowerCase()] = setting;
    }
  if (value.npmRegistry) values.NPM_CONFIG_REGISTRY = value.npmRegistry;
  if (value.pipIndex) values.PIP_INDEX_URL = value.pipIndex;
  return values;
}
export function rewriteMirrors(text: string, distro: string, config: NetworkProfile) {
  if (distro === 'alpine')
    return config.apkMirror
      ? text.replace(/https?:\/\/[^\s#]+?(?=\/v\d+\.\d+\/|\/edge\/)/g, () =>
          config.apkMirror.replace(/\/$/, ''),
        )
      : text;
  return text
    .split('\n')
    .map((line) => {
      // Only repository URI fields may change; preserve comments and signing-key URLs.
      if (!/^\s*(?:deb(?:-src)?\s|URIs:)/.test(line)) return line;
      const split = line.indexOf('#'),
        body = split < 0 ? line : line.slice(0, split),
        comment = split < 0 ? '' : line.slice(split);
      return (
        body.replace(/https?:\/\/[^\s]+/g, (value) => {
          const url = new URL(value);
          if (!/(^|\.)(debian\.org|ubuntu\.com)$/.test(url.hostname)) return value;
          const security = /security|debian-security/.test(url.hostname + url.pathname);
          return (security ? config.aptSecurityMirror : config.aptMirror) || value;
        }) + comment
      );
    })
    .join('\n');
}
export class NetworkProfiles {
  jobs = new Jobs('network');
  constructor(private machines: Machines) {}
  private file(id: string) {
    this.machines.get(id);
    return join(vmDir(id), 'network.json');
  }
  async state(id: string) {
    const state = await readStore<NetworkState>(this.file(id), () => ({
      config: networkSchema.parse({}),
      changes: [],
    }));
    return { ...state, config: networkSchema.parse(state.config) };
  }
  async profiles() {
    return z
      .array(savedProfileSchema)
      .max(40)
      .parse(await readStore(join(DATA, 'network-profiles.json'), () => []));
  }
  async saveProfile(input: unknown) {
    const value = savedProfileSchema
      .omit({ id: true, updatedAt: true })
      .extend({ id: z.uuid().optional() })
      .parse(input);
    return this.machines.locked('network-profiles', async () => {
      const profiles = await this.profiles();
      const existing = value.id ? profiles.find((item) => item.id === value.id) : undefined;
      if (value.id && !existing) throw new AppError('网络档案不存在', 404);
      if (!existing && profiles.length >= 40) throw new AppError('最多保存 40 个网络档案');
      if (
        profiles.some(
          (item) => item.id !== existing?.id && item.name.toLowerCase() === value.name.toLowerCase(),
        )
      )
        throw new AppError('网络档案名称已存在', 409);
      const saved = { ...value, id: existing?.id || randomUUID(), updatedAt: new Date().toISOString() };
      const next = [...profiles.filter((item) => item.id !== saved.id), saved];
      await writeStore(join(DATA, 'network-profiles.json'), next);
      return saved;
    });
  }
  async removeProfile(id: string) {
    z.uuid().parse(id);
    return this.machines.locked('network-profiles', async () => {
      const profiles = await this.profiles();
      if (!profiles.some((item) => item.id === id)) throw new AppError('网络档案不存在', 404);
      await writeStore(
        join(DATA, 'network-profiles.json'),
        profiles.filter((item) => item.id !== id),
      );
      return { removed: id };
    });
  }
  async environment(id: string) {
    const state = await this.state(id);
    return state.appliedAt ? networkEnvironment(state.config) : {};
  }
  private async read(id: string, path: string) {
    const info = await this.machines.sftp(id, (ftp) => ftpStat(ftp, path));
    if (!info) return null;
    if (!info.isFile()) throw new AppError(`配置不是普通文件：${path}`);
    return this.machines.readGuestFile(id, path);
  }
  async preview(id: string, input: unknown, signal?: AbortSignal) {
    const config = networkSchema.parse(input),
      vm = this.machines.get(id);
    const previous = await this.state(id);
    if (previous.appliedAt || previous.changes.length || previous.forwards || previous.dnsBackend || previous.resolverLink)
      throw new AppError('请先恢复原配置，再应用新的网络设置');
    const changes: NetworkChange[] = [];
    let dnsBackend: 'resolved' | undefined;
    let resolverLink: NetworkState['resolverLink'];
    const forwards =
      config.forwards && !sameForwards(vm.forwards, config.forwards)
        ? { before: structuredClone(vm.forwards), after: config.forwards }
        : undefined;
    const add = async (path: string, after: (before: string | null) => string) => {
      signal?.throwIfAborted();
      const before = await this.read(id, path),
        next = after(before);
      if (next !== before) changes.push({ path, before, after: next });
    };
    if (config.dnsDomains.length && !config.dnsServers.length)
      throw new AppError('私有域名路由需要指定 DNS 服务器');
    if (config.dnssec !== 'inherit' && !config.dnsServers.length)
      throw new AppError('DNSSEC 策略需要同时指定 DNS 服务器，避免沿用未受该策略控制的链路 DNS');
    if (config.dnsServers.length || config.dnssec !== 'inherit') {
      if (!vm.distro || vm.distro === 'alpine') {
        if (config.dnsDomains.length || config.dnssec !== 'inherit')
          throw new AppError('私有域名路由和 DNSSEC 策略需要 systemd-resolved；Alpine 当前仅支持静态 DNS 地址');
        const interfaces = await this.read(id, '/etc/network/interfaces');
        if (
          !interfaces ||
          !/^\s*iface\s+eth0\s+inet\s+static\s*$/m.test(interfaces) ||
          /\binet6?\s+(?:dhcp|auto)\b/.test(interfaces)
        )
          throw new AppError('自定义 DNS 需要 Alpine 静态网络，当前解析器由其他网络管理器维护');
        await add(
          '/etc/resolv.conf',
          (before) =>
            (before || '')
              .split('\n')
              .filter((line) => !/^\s*nameserver\s/.test(line) && line !== '# Managed by Sakura')
              .join('\n')
              .trimEnd() +
            '\n# Managed by Sakura\n' +
            config.dnsServers.map((address) => `nameserver ${address}`).join('\n') +
            '\n',
        );
      } else {
        const resolver = await this.machines.exec(
          id,
          'systemctl is-active --quiet systemd-resolved && readlink -f /etc/resolv.conf',
          10000,
          signal,
        );
        const target = resolver.stdout.trim();
        if (resolver.code !== 0 ||
            !['/run/systemd/resolve/stub-resolv.conf', '/run/systemd/resolve/resolv.conf'].includes(target))
          throw new AppError(
            '此实例的 DNS 后端不受支持：需要 systemd-resolved 管理 /etc/resolv.conf；可清空 DNS 地址沿用系统设置',
          );
        if (target === '/run/systemd/resolve/resolv.conf' &&
            (config.dnsDomains.length || config.dnssec !== 'inherit')) {
          const link = await this.machines.exec(id, 'readlink /etc/resolv.conf', 10000, signal);
          const before = link.stdout.trim();
          if (link.code !== 0 || posix.resolve('/etc', before) !== target)
            throw new AppError('无法安全切换客户机解析器链接');
          resolverLink = { before, after: '/run/systemd/resolve/stub-resolv.conf' };
        }
        dnsBackend = 'resolved';
        await add(
          '/etc/systemd/resolved.conf.d/90-sakura.conf',
          () => [
            '[Resolve]',
            ...(config.dnsServers.length ? [
              'DNS=',
              `DNS=${config.dnsServers.join(' ')}`,
              'Domains=',
              `Domains=${config.dnsDomains.length ? config.dnsDomains.map((domain) => `~${domain}`).join(' ') : '~.'}`,
            ] : []),
            ...(config.dnssec !== 'inherit' ? [`DNSSEC=${config.dnssec}`] : []),
            '',
          ].join('\n'),
        );
      }
    }
    await add(
      '/etc/profile.d/sakura-network.sh',
      () => '# Managed by Sakura\n' + envPrefix(networkEnvironment(config)) + '\n',
    );
    if (!vm.distro || vm.distro === 'alpine') {
      if (config.apkMirror)
        await add('/etc/apk/repositories', (before) => rewriteMirrors(before || '', 'alpine', config));
    } else {
      await add(
        '/etc/apt/apt.conf.d/90sakura-proxy',
        () =>
          [
            config.httpProxy && `Acquire::http::Proxy "${config.httpProxy.replaceAll('"', '%22')}";`,
            config.httpsProxy && `Acquire::https::Proxy "${config.httpsProxy.replaceAll('"', '%22')}";`,
          ]
            .filter(Boolean)
            .join('\n') + '\n',
      );
      if (config.aptMirror || config.aptSecurityMirror) {
        const result = await this.machines.exec(
          id,
          "find /etc/apt -maxdepth 2 -type f \\( -name '*.list' -o -name '*.sources' \\) -print",
          10000,
          signal,
        );
        if (result.code !== 0) throw new AppError('无法读取 APT 软件源');
        const paths = result.stdout.trim().split('\n').filter(Boolean);
        if (paths.length > 30) throw new AppError('软件源文件过多，请手动配置');
        for (const path of paths) {
          if (!/^\/etc\/apt\/[A-Za-z0-9_./-]+\.(list|sources)$/.test(path) || path.includes('..'))
            throw new AppError('软件源路径不受支持');
          await add(path, (before) => rewriteMirrors(before || '', vm.distro!, config));
        }
      }
    }
    const token = createHash('sha256')
      .update(JSON.stringify({ id, config, changes, forwards, dnsBackend, resolverLink }))
      .digest('hex');
    return { config, changes, forwards, dnsBackend, resolverLink, token };
  }
  private async readResolverLink(id: string) {
    const result = await this.machines.exec(id, 'readlink /etc/resolv.conf', 10000);
    if (result.code !== 0) throw new AppError('客户机解析器链接不可读取', 409);
    return result.stdout.trim();
  }
  private async switchResolverLink(id: string, before: string, after: string) {
    const temp = `/etc/.sakura-resolv-${randomUUID()}`;
    const command = [
      'set -eu',
      `test "$(readlink /etc/resolv.conf)" = ${quote(before)}`,
      `temp=${quote(temp)}`,
      'trap \'rm -f "$temp"\' EXIT',
      `ln -s ${quote(after)} "$temp"`,
      'mv -Tf "$temp" /etc/resolv.conf',
      `test "$(readlink /etc/resolv.conf)" = ${quote(after)}`,
    ].join('\n');
    const result = await this.machines.exec(id, command, 10000);
    if (result.code !== 0) throw new AppError('客户机解析器链接切换失败，请恢复原配置', 409);
  }
  private async reloadDns(id: string, expected?: Pick<NetworkProfile, 'dnsServers' | 'dnsDomains' | 'dnssec'>) {
    const result = await this.machines.exec(
      id,
      'set -eu\nsystemctl restart systemd-resolved\nLC_ALL=C resolvectl dns',
      30000,
    );
    if (result.code !== 0) throw new AppError('重新加载 DNS 失败，请恢复原配置后检查解析器');
    if (expected?.dnsServers.length) {
      const global =
        result.stdout
          .split('\n')
          .find((line) => /^Global:/.test(line))
          ?.slice(7)
          .trim()
          .split(/\s+/) || [];
      if (!expected.dnsServers.every((address) => global.map(canonicalIp).includes(canonicalIp(address))))
        throw new AppError('DNS 服务没有使用所选地址，请恢复原配置后检查解析器');
    }
    if (expected?.dnsServers.length) {
      const domain = await this.machines.exec(id, 'LC_ALL=C resolvectl domain', 10000);
      if (domain.code !== 0) throw new AppError('无法核对私有域名路由，请恢复原配置后检查解析器');
      const global = domain.stdout.split('\n').find((line) => /^Global:/.test(line))?.slice(7).trim().split(/\s+/) || [];
      const required = expected.dnsDomains.length
        ? expected.dnsDomains.map((value) => `~${value}`)
        : ['~.'];
      if (!required.every((value) => global.includes(value)))
        throw new AppError('DNS 服务没有使用所选域名路由，请恢复原配置后检查解析器');
    }
    if (expected?.dnssec !== undefined && expected.dnssec !== 'inherit') {
      const dnssec = await this.machines.exec(id, 'LC_ALL=C resolvectl dnssec', 10000);
      if (dnssec.code !== 0 ||
          !dnssec.stdout.split('\n').some((line) => line.trim() === `Global: ${expected.dnssec}`))
        throw new AppError('DNSSEC 策略没有生效，请恢复原配置后检查解析器');
    }
  }
  async apply(id: string, input: unknown, token: string) {
    return this.machines.locked(`network:${id}`, async () => {
      const preview = await this.preview(id, input);
      if (preview.token !== token) throw new AppError('配置已变化，请重新预览', 409);
      // Persist the complete rollback plan before the first guest write.
      const state: NetworkState = {
        config: preview.config,
        changes: preview.changes,
        forwards: preview.forwards,
        dnsBackend: preview.dnsBackend,
        resolverLink: preview.resolverLink,
      };
      await writeStore(this.file(id), state);
      if (preview.forwards)
        await this.machines.setForwards(id, preview.forwards.after, preview.forwards.before);
      for (const change of preview.changes) {
        await this.machines.exec(id, `mkdir -p ${quote(posix.dirname(change.path))}`);
        await this.machines.writeGuestFile(
          id,
          change.path,
          change.after,
          change.before !== null,
          change.before === null ? undefined : textVersion(change.before),
        );
      }
      if (preview.dnsBackend) await this.reloadDns(id, preview.config);
      if (preview.resolverLink)
        await this.switchResolverLink(id, preview.resolverLink.before, preview.resolverLink.after);
      state.appliedAt = new Date().toISOString();
      await writeStore(this.file(id), state);
      return state;
    });
  }
  async restore(id: string) {
    return this.machines.locked(`network:${id}`, async () => {
      const state = await this.state(id);
      // Validate every file before restoring any of them.
      for (const change of state.changes) {
        const current = await this.read(id, change.path);
        if (current !== change.after && current !== change.before)
          throw new AppError(`配置被外部修改，恢复前请处理：${change.path}`, 409);
      }
      if (state.resolverLink) {
        const current = await this.readResolverLink(id);
        if (current !== state.resolverLink.before && current !== state.resolverLink.after)
          throw new AppError('解析器链接被外部修改，恢复前请处理', 409);
      }
      if (state.forwards) {
        const current = this.machines.get(id).forwards;
        if (!sameForwards(current, state.forwards.before)) {
          if (!sameForwards(current, state.forwards.after))
            throw new AppError('端口映射被外部修改，恢复前请处理', 409);
          await this.machines.setForwards(id, state.forwards.before, state.forwards.after);
        }
        delete state.forwards;
        await writeStore(this.file(id), state);
      }
      const files = new Files(this.machines);
      while (state.changes.length) {
        const change = state.changes.at(-1)!;
        if ((await this.read(id, change.path)) !== change.before) {
          if (change.before === null) await files.operation(id, 'delete', change.path);
          else
            await this.machines.writeGuestFile(
              id,
              change.path,
              change.before,
              true,
              textVersion(change.after),
            );
        }
        state.changes.pop();
        await writeStore(this.file(id), state);
      }
      if (state.dnsBackend) {
        await this.reloadDns(id);
        delete state.dnsBackend;
      }
      if (state.resolverLink) {
        if ((await this.readResolverLink(id)) === state.resolverLink.after)
          await this.switchResolverLink(id, state.resolverLink.after, state.resolverLink.before);
        delete state.resolverLink;
      }
      delete state.appliedAt;
      await writeStore(this.file(id), state);
      return state;
    });
  }
  test(id: string, input: unknown) {
    const config = networkSchema.parse(input);
    this.machines.get(id);
    return this.jobs.start(
      id,
      async (log, signal) => {
        const urls = [
          ...new Set(
            [
              'https://example.com',
              config.npmRegistry,
              config.pipIndex,
              config.apkMirror,
              config.aptMirror,
              config.aptSecurityMirror,
            ].filter(Boolean),
          ),
        ];
        for (const url of urls) {
          signal.throwIfAborted();
          log(`测试 ${url}…\n`);
          const result = await guestTask(
            this.machines,
            id,
            `${envPrefix(networkEnvironment(config))}\nif command -v curl >/dev/null; then curl -fsSLI --max-time 10 ${quote(url)} >/dev/null; else wget -q --spider -T 10 ${quote(url)}; fi`,
            signal,
            undefined,
            15000,
          );
          log(result.code === 0 ? '连接通过\n' : '连接失败，请检查地址、代理和证书\n');
          if (result.code !== 0) throw new AppError(`连接测试失败：${url}`);
        }
      },
      { title: '网络配置连通性测试', vmId: id },
    );
  }
  close() {
    return this.jobs.close();
  }
}
