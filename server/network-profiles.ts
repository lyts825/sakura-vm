import { createHash } from 'node:crypto';
import { join, posix } from 'node:path';
import { z } from 'zod';
import { AppError, vmDir } from './model.ts';
import type { Machines } from './machines.ts';
import { Files, ftpStat, quote, textVersion } from './files.ts';
import { envPrefix } from './project-services.ts';
import { readStore, writeStore } from './local-store.ts';
import { Jobs } from './jobs.ts';
import { guestTask } from './guest-task.ts';

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
export const networkSchema = z
  .object({
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
  })
  .strict();
export type NetworkProfile = z.infer<typeof networkSchema>;
export type NetworkChange = { path: string; before: string | null; after: string };
type NetworkState = { config: NetworkProfile; changes: NetworkChange[]; appliedAt?: string };
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
  state(id: string) {
    return readStore<NetworkState>(this.file(id), () => ({ config: networkSchema.parse({}), changes: [] }));
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
    if (previous.appliedAt || previous.changes.length)
      throw new AppError('请先恢复原配置，再应用新的网络设置');
    const changes: NetworkChange[] = [];
    const add = async (path: string, after: (before: string | null) => string) => {
      signal?.throwIfAborted();
      const before = await this.read(id, path),
        next = after(before);
      if (next !== before) changes.push({ path, before, after: next });
    };
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
    const token = createHash('sha256').update(JSON.stringify({ id, config, changes })).digest('hex');
    return { config, changes, token };
  }
  async apply(id: string, input: unknown, token: string) {
    return this.machines.locked(`network:${id}`, async () => {
      const preview = await this.preview(id, input);
      if (preview.token !== token) throw new AppError('配置已变化，请重新预览', 409);
      // Persist the complete rollback plan before the first guest write.
      const state: NetworkState = { config: preview.config, changes: preview.changes };
      await writeStore(this.file(id), state);
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
