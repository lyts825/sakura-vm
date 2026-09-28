import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './model.ts';
import { quote } from './files.ts';
import type { Machines } from './machines.ts';

const packageName = z.string().min(1).max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9+_.-]*$/, '软件包名称无效')
  .refine((value) => !/[+-]$/.test(value), '软件包名称不能以 + 或 - 结尾');
const querySchema = z.object({
  mode: z.enum(['installed', 'search', 'updates']),
  query: z.string().trim().max(100).default(''),
  page: z.number().int().min(1).max(100).default(1),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
const changeSchema = z.enum(['install', 'remove', 'upgrade', 'upgrade-all']);
export const packageWorkbenchRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('preview'), change: changeSchema,
    name: packageName.optional() }).strict(),
  z.object({ operation: z.literal('apply'), token: z.uuid() }).strict(),
  z.object({ operation: z.literal('refresh-index') }).strict(),
]);
type Change = z.infer<typeof changeSchema>;
type Item = { name: string; version: string; description?: string;
  installedVersion?: string; availableVersion?: string };
type Preview = { vmId: string; change: Change; name?: string; digest: string;
  boot: object; expiresAt: number };
type Runner = (id: string, operation: Change | 'update', name?: string) => unknown;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function parsePackageRows(manager: 'apk' | 'apt', mode: 'installed' | 'search' | 'updates',
  output: string): Item[] {
  const items: Item[] = [];
  for (const line of output.split(/\r?\n/)) {
    let match: RegExpMatchArray | null;
    if (manager === 'apk' && mode === 'installed') {
      match = line.match(/^(.+)-([0-9][^ ]*)\s+\S+.*\[installed\]$/);
      if (match) items.push({ name: match[1], version: match[2], installedVersion: match[2] });
    } else if (manager === 'apk' && mode === 'search') {
      match = line.match(/^(.+)-([0-9][^ ]*) - (.*)$/);
      if (match) items.push({ name: match[1], version: match[2], description: match[3] });
    } else if (manager === 'apk') {
      match = line.match(/^(.+)-([0-9][^ ]*)\s+<\s+(\S+)/);
      if (match) items.push({ name: match[1], version: match[3],
        installedVersion: match[2], availableVersion: match[3] });
    } else if (mode === 'installed') {
      const [status, name, version] = line.split('\t');
      if (status?.startsWith('ii') && name && version)
        items.push({ name, version, installedVersion: version });
    } else if (mode === 'search') {
      match = line.match(/^([^\s]+) - (.*)$/);
      if (match) items.push({ name: match[1], version: '', description: match[2] });
    } else {
      match = line.match(/^([^/\s]+)\/\S+\s+(\S+)\s+\S+\s+\[upgradable from: (\S+)\]$/);
      if (match) items.push({ name: match[1], version: match[2],
        installedVersion: match[3], availableVersion: match[2] });
    }
  }
  return items;
}

function managerFor(distro?: string): 'apk' | 'apt' {
  return !distro || distro === 'alpine' ? 'apk' : 'apt';
}

function simulateCommand(manager: 'apk' | 'apt', change: Change, name?: string) {
  const argument = name ? quote(name) : '';
  if (manager === 'apk') return {
    install: `apk add --simulate ${argument}`,
    remove: `apk del --simulate ${argument}`,
    upgrade: `apk upgrade --simulate ${argument}`,
    'upgrade-all': 'apk upgrade --simulate',
  }[change];
  return {
    install: `apt-get -s install ${argument}`,
    remove: `apt-get -s remove ${argument}`,
    upgrade: `apt-get -s --only-upgrade install ${argument}`,
    'upgrade-all': 'apt-get -s upgrade',
  }[change];
}

export class PackageWorkbench {
  private previews = new Map<string, Preview>();
  constructor(private machines: Machines, private run: Runner) {}

  async query(id: string, raw: unknown, signal?: AbortSignal) {
    const input = querySchema.parse(raw);
    const vm = this.machines.get(id);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
    if (input.mode === 'search' && input.query.length < 2)
      throw new AppError('搜索至少需要 2 个字符');
    const manager = managerFor(vm.distro);
    const command = manager === 'apk'
      ? { installed: 'apk list --installed',
        search: `apk search -v ${quote(input.query)}`,
        updates: "apk version -l '<'" }[input.mode]
      : { installed: "dpkg-query -W -f='${db:Status-Abbrev}\\t${binary:Package}\\t${Version}\\n'",
        search: `apt-cache search ${quote(input.query)}`,
        updates: 'apt list --upgradable 2>/dev/null' }[input.mode];
    const result = await this.machines.exec(id, command, 30_000, signal);
    if (result.code !== 0) throw new AppError(result.stderr || '软件包列表查询失败', 502);
    const filter = input.mode === 'search' ? '' : input.query.toLowerCase();
    const all = parsePackageRows(manager, input.mode, result.stdout)
      .filter((item) => !filter || item.name.toLowerCase().includes(filter));
    const start = (input.page - 1) * input.limit;
    return { vmId: id, mode: input.mode, manager, query: input.query, page: input.page,
      total: all.length, items: all.slice(start, start + input.limit),
      hasMore: start + input.limit < all.length,
      warning: result.stderr.trim().slice(0, 1000) };
  }

  private async simulate(id: string, change: Change, name?: string, signal?: AbortSignal) {
    this.machines.get(id);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
    if (change === 'upgrade-all' ? !!name : !name)
      throw new AppError('软件包操作参数无效');
    if (name) packageName.parse(name);
    const manager = managerFor(this.machines.get(id).distro);
    const command = simulateCommand(manager, change, name);
    const result = await this.machines.exec(id, command, 60_000, signal);
    if (result.code !== 0) throw new AppError(result.stderr || result.stdout || '软件包预览失败', 502);
    const plan = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
    if (!plan) throw new AppError('软件包管理器没有返回可复核的预览', 502);
    return { manager, plan: plan.slice(0, 32_768), digest: hash(plan) };
  }

  async action(id: string, raw: unknown, signal?: AbortSignal) {
    const input = packageWorkbenchRequest.parse(raw);
    this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (input.operation === 'refresh-index') {
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
      return { job: this.run(id, 'update') };
    }
    if (input.operation === 'preview') {
      const result = await this.simulate(id, input.change, input.name, signal);
      const token = randomUUID();
      const expiresAt = Date.now() + 5 * 60_000;
      this.previews.set(token, { vmId: id, change: input.change, name: input.name,
        digest: result.digest, expiresAt, boot: this.machines.live.get(id)! });
      if (this.previews.size > 100) {
        for (const [key, value] of this.previews)
          if (value.expiresAt < Date.now() || this.previews.size > 100) this.previews.delete(key);
      }
      return { token, expiresAt, manager: result.manager, plan: result.plan,
        change: input.change, name: input.name || null };
    }
    const preview = this.previews.get(input.token);
    this.previews.delete(input.token);
    if (!preview || preview.vmId !== id || preview.expiresAt < Date.now() ||
        preview.boot !== this.machines.live.get(id))
      throw new AppError('预览已过期，请重新检查软件包变更', 409);
    const current = await this.simulate(id, preview.change, preview.name, signal);
    if (current.digest !== preview.digest)
      throw new AppError('软件包计划已变化，请重新预览', 409);
    return { job: this.run(id, preview.change, preview.name) };
  }
}
