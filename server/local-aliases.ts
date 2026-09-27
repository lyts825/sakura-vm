import { lstat, open, readFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { localAliasActionSchema, type LocalAliasView } from '../shared/local-aliases.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError, DATA } from './model.ts';

const BEGIN = '# BEGIN SAKURA LOCAL ALIASES';
const END = '# END SAKURA LOCAL ALIASES';
const aliasPattern = /^app-[a-f0-9]{32}\.sakura\.localhost$/;
const configSchema = z.object({ enabled: z.boolean() }).strict();
const defaultHosts = process.platform === 'win32'
  ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts') : null;

type Parsed = { outside: string; managed: string[]; newline: string };

function parseHosts(text: string): Parsed {
  const lines = text.split('\n');
  const normalized = lines.map((line) => line.replace(/\r$/, ''));
  const starts = normalized.flatMap((line, index) => line === BEGIN ? [index] : []);
  const ends = normalized.flatMap((line, index) => line === END ? [index] : []);
  if (starts.length !== ends.length || starts.length > 1 ||
      (starts.length === 1 && starts[0] >= ends[0]))
    throw new AppError('系统 hosts 文件中的 Sakura 标记区块不完整或重复，请先人工检查', 409);
  const managed: string[] = [];
  if (starts.length) {
    for (const line of normalized.slice(starts[0] + 1, ends[0])) {
      const match = /^127\.0\.0\.1 ([^\s#]+)$/.exec(line);
      if (!match || !aliasPattern.test(match[1]))
        throw new AppError('Sakura 标记区块包含未知内容，请先人工检查', 409);
      managed.push(match[1]);
    }
  }
  const outside = starts.length
    ? [...lines.slice(0, starts[0]), ...lines.slice(ends[0] + 1)].join('\n') : text;
  return { outside, managed, newline: text.includes('\r\n') ? '\r\n' : '\n' };
}

function decodeHosts(buffer: Buffer) {
  const bom = buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bom ? buffer.subarray(3) : buffer); }
  catch { throw new AppError('系统 hosts 文件不是 UTF-8，无法安全修改', 409); }
  if (text.includes('\0')) throw new AppError('系统 hosts 文件使用不受支持的编码', 409);
  return { text, bom };
}

export function renderLocalAliases(original: Buffer, desired: string[]) {
  if (desired.length > 24 || desired.some((name) => !aliasPattern.test(name)) ||
      new Set(desired).size !== desired.length)
    throw new AppError('本地域名列表无效', 400);
  const { text, bom } = decodeHosts(original);
  const parsed = parseHosts(text);
  const external = new Set<string>();
  for (const line of parsed.outside.split(/\r?\n/)) {
    const parts = line.split('#', 1)[0].trim().split(/\s+/);
    for (const name of parts.slice(1)) {
      if (!desired.includes(name.toLowerCase())) continue;
      if (parts[0] !== '127.0.0.1')
        throw new AppError(`本地域名 ${name} 已被其他 hosts 规则占用`, 409);
      external.add(name.toLowerCase());
    }
  }
  const managed = desired.filter((name) => !external.has(name)).sort();
  let next = parsed.outside;
  if (managed.length) {
    if (next && !next.endsWith('\n')) next += parsed.newline;
    next += [BEGIN, ...managed.map((name) => `127.0.0.1 ${name}`), END, '']
      .join(parsed.newline);
  }
  return { next: Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0),
    Buffer.from(next, 'utf8')]), managed: parsed.managed, external: [...external] };
}

export class LocalAliases {
  private enabled = false;
  private lastError?: string;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private names: () => string[], private hostsFile: string | null = defaultHosts,
    private file = join(DATA, 'plugins', 'network', 'local-aliases.json'),
    private resolver: ((name: string) => Promise<string>) | undefined =
      hostsFile && hostsFile === defaultHosts
        ? async (name) => (await lookup(name, { family: 4 })).address : undefined) {}

  async init() {
    this.enabled = configSchema.parse(await readStore(this.file, () => ({ enabled: false }))).enabled;
    await this.refresh();
  }

  private desired() {
    return [...new Set(this.names())].sort();
  }

  private requireHosts() {
    if (!this.hostsFile) throw new AppError('当前系统不支持 Windows hosts 别名管理', 501);
    return this.hostsFile;
  }

  private async readHosts() {
    const path = this.requireHosts();
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024)
      throw new AppError('系统 hosts 文件不是普通文件或超过 1 MiB', 409);
    return readFile(path);
  }

  async view(): Promise<LocalAliasView> {
    const aliases = this.desired();
    if (!this.hostsFile) return { enabled: this.enabled, supported: false,
      aliases, installed: [], missing: aliases, stale: [],
      error: '当前系统不支持 Windows hosts 别名管理' };
    try {
      const current = await this.readHosts();
      const parsed = parseHosts(decodeHosts(current).text);
      const { external } = renderLocalAliases(current, aliases);
      const installed = [...new Set([...parsed.managed, ...external])].sort();
      return { enabled: this.enabled, supported: true, aliases, installed,
        missing: this.enabled ? aliases.filter((name) => !installed.includes(name)) : [],
        stale: parsed.managed.filter((name) => !this.enabled || !aliases.includes(name)),
        ...(this.lastError ? { error: this.lastError } : {}) };
    } catch (error) {
      return { enabled: this.enabled, supported: true, aliases, installed: [],
        missing: this.enabled ? aliases : [], stale: [], error: (error as Error).message };
    }
  }

  private async writeHosts(next: Buffer, original: Buffer) {
    const handle = await open(this.requireHosts(), 'r+').catch((error) => {
      if (['EACCES', 'EPERM'].includes(error.code))
        throw new AppError('修改系统 hosts 文件需要管理员权限；请以管理员身份运行 Sakura 后重试', 403);
      throw error;
    });
    let started = false;
    const replace = async (value: Buffer) => {
      let offset = 0;
      while (offset < value.length) {
        const { bytesWritten } = await handle.write(value, offset, value.length - offset, offset);
        if (!bytesWritten) throw new Error('系统 hosts 文件写入未完成');
        offset += bytesWritten;
      }
      await handle.truncate(value.length);
      await handle.sync();
    };
    try {
      const info = await handle.stat();
      if (info.size !== original.length) throw new AppError('系统 hosts 文件已被其他程序修改，请重试', 409);
      const check = Buffer.alloc(original.length);
      const { bytesRead } = await handle.read(check, 0, check.length, 0);
      if (bytesRead !== original.length || !check.equals(original))
        throw new AppError('系统 hosts 文件已被其他程序修改，请重试', 409);
      started = true;
      await replace(next);
    } catch (error) {
      const rollbackError = started ? await replace(original).then(() => null,
        (failure: Error) => failure) : null;
      if (rollbackError)
        throw new AppError('系统 hosts 文件写入与回滚都失败，请立即人工检查 hosts 文件', 500);
      if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code || ''))
        throw new AppError('修改系统 hosts 文件需要管理员权限；请以管理员身份运行 Sakura 后重试', 403);
      throw error;
    } finally { await handle.close(); }
  }

  private async syncNow() {
    const original = await this.readHosts();
    const desired = this.enabled ? this.desired() : [];
    const { next } = renderLocalAliases(original, desired);
    if (!next.equals(original)) await this.writeHosts(next, original);
    for (const name of desired) {
      if (!this.resolver) break;
      let address: string;
      try { address = await this.resolver(name); }
      catch { throw new AppError(`系统解析器仍无法解析 ${name}；请刷新 DNS 缓存后重试`, 409); }
      if (address !== '127.0.0.1')
        throw new AppError(`系统解析器把 ${name} 解析为 ${address}，而不是本机回环地址`, 409);
    }
    this.lastError = undefined;
  }

  private serialize<T>(work: () => Promise<T>) {
    const operation = this.writes.catch(() => {}).then(work);
    this.writes = operation;
    return operation;
  }

  async refresh() {
    await this.serialize(async () => {
      try { await this.syncNow(); }
      catch (error) { this.lastError = (error as Error).message; }
    });
  }

  async action(input: unknown) {
    const parsed = localAliasActionSchema.parse(input);
    return this.serialize(async () => {
      if (parsed.action === 'set-enabled') {
        const previous = this.enabled;
        this.enabled = parsed.enabled;
        try { await writeStore(this.file, { enabled: this.enabled }); }
        catch (error) { this.enabled = previous; throw error; }
      }
      try { await this.syncNow(); }
      catch (error) {
        this.lastError = (error as Error).message;
        throw error;
      }
      return this.view();
    });
  }
}
