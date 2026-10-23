/** 中文：可信更新的应用边界，绑定安装根并监督可取消的暂存进程。English: Application boundary binding the installation root and supervising cancellable staging. */
import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './paths.ts';
import { hostProcess } from './host-process.ts';
import { networkFor } from './network/index.ts';
import { AppError } from '../shared/errors.ts';
import { captureOperationCheck } from './operation-context.ts';
import { trustedUpdateRequest, trustedUpdateResponseSchema, type TrustedUpdateView } from '../shared/contracts/trusted-update.ts';

type Toolkit = typeof import('../scripts/trusted-update.mjs');
export class TrustedUpdates {
  private controller = new AbortController();
  private pending = new Set<Promise<unknown>>();
  private previews = new Map<string, { path: string; fingerprint: string; revision: number; expires: number }>();
  private toolkit?: Promise<Toolkit>;
  private network = networkFor('core:trusted-update');
  /** 中文：安装根来自启动器环境，不接受请求中的根目录。English: Installation root is supplied by the launcher, never by a request. */
  private async installation() {
    const installed = resolve(process.env.SAKURA_INSTALLATION_ROOT || ROOT);
    const actual = await realpath(installed), running = await realpath(ROOT), info = await lstat(installed);
    const child = relative(actual, running).replaceAll('\\', '/');
    if (!info.isDirectory() || info.isSymbolicLink() || (actual !== running && !/^versions\/[a-f0-9]{32}$/.test(child)))
      throw new AppError('启动器提供的安装根与当前应用不匹配', 409);
    return actual;
  }
  private tools(): Promise<Toolkit> {
    // 中文：加载当前受信任版本自带的工具，保持发行包脚本的独立路径语义。English: Load tools shipped with the running version, preserving release-script path semantics.
    return this.toolkit ||= import(/* @vite-ignore */ pathToFileURL(join(ROOT, 'scripts', 'trusted-update.mjs')).href);
  }
  private track<T>(work: (signal: AbortSignal) => Promise<T>, external?: AbortSignal) {
    const signal = external ? AbortSignal.any([external, this.controller.signal]) : this.controller.signal;
    const result = Promise.resolve().then(() => { signal.throwIfAborted(); return work(signal); });
    this.pending.add(result); void result.finally(() => this.pending.delete(result)).catch(() => {});
    return result;
  }
  async view(): Promise<TrustedUpdateView> {
    const toolkit = await this.tools();
    return trustedUpdateResponseSchema.parse(await toolkit.trustedUpdateView(await this.installation()));
  }
  async init() { await this.view(); }
  action(value: unknown, external?: AbortSignal): Promise<TrustedUpdateView> {
    const input = trustedUpdateRequest.parse(value);
    const operationCheck = captureOperationCheck();
    return this.track(async (signal) => {
      const toolkit = await this.tools(), installation = await this.installation();
      signal.throwIfAborted();
      const check = async () => { signal.throwIfAborted(); await operationCheck(); signal.throwIfAborted(); };
      let message = '', checked: TrustedUpdateView['checked'];
      if (input.action === 'add-publisher' || input.action === 'remove-publisher') {
        await toolkit.changePublisher(installation, input, check); this.previews.clear(); message = '发布者信任配置已保存。';
      } else if (input.action === 'check') {
        const result = await toolkit.checkTrustedUpdate(installation, input.path);
        signal.throwIfAborted();
        const token = randomUUID();
        this.previews.clear();
        this.previews.set(token, { path: result.path, revision: result.revision, fingerprint: result.manifest.fingerprint, expires: Date.now() + 600_000 });
        checked = { token, version: result.manifest.version, fingerprint: result.manifest.fingerprint,
          publisher: result.publisher.label, source: result.publisher.source, sequence: result.envelope.sequence,
          expiresAt: result.envelope.expiresAt, files: result.manifest.files.length };
      } else if (input.action === 'stage') {
        const plan = this.previews.get(input.token); this.previews.delete(input.token);
        if (!plan || plan.expires <= Date.now()) throw new AppError('更新检查已过期，请重新检查', 409);
        const proxy = await this.network.proxyEnvironment();
        try {
          await check();
          const result = await hostProcess('trusted-update', process.execPath,
            [join(ROOT, 'scripts', 'trusted-update.mjs'), 'stage', installation, JSON.stringify(plan)],
            { signal, timeout: 120_000, maxBuffer: 1024 * 1024, cwd: ROOT, env: { ...process.env, ...proxy.env }, lane: 'background' });
          if (result.code !== 0) throw new AppError(result.stderr.trim().slice(-2000) || '可信更新暂存失败', 409);
        } finally { await proxy.close(); }
        message = '已验证签名、安装依赖并通过隔离健康检查；可选择该候选版本启用。';
      } else if (input.action === 'activate') {
        await toolkit.activateTrustedUpdate(installation, input, check); message = '启动指针已切换；重启 Sakura 后生效。';
      } else {
        await toolkit.rollbackTrustedUpdate(installation, input, check); message = '启动指针已回退；重启 Sakura 后生效。';
      }
      signal.throwIfAborted();
      return trustedUpdateResponseSchema.parse({ ...await this.view(), checked, message: message || undefined });
    }, external);
  }
  async close() {
    this.controller.abort(new AppError('可信更新服务正在关闭', 503)); this.previews.clear();
    await Promise.allSettled([...this.pending]);
  }
}
