/**
 * 模块职责：解析依赖下载凭证并部署临时认证代理；清理按原临时路径和客户机启动身份执行。
 * Module purpose: Resolves dependency credentials and installs temporary brokers; cleanup pins the original path and guest boot identity.
 */
import type { SecretsV1 } from './service-contracts/v1.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { ROOT } from './paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { secretName } from './secrets.ts';
import { quote } from './shell.ts';

/**
 * 入口 / Entry: callback@22.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.string().min().max().refine / 认证下载需要不含凭证或查询参数的 HTTPS 地址；HTTP 仅用于客户机回环地址）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.string().min().max().refine / 认证下载需要不含凭证或查询参数的 HTTPS 地址；HTTP 仅用于客户机回环地址).
 * 输入 / Inputs: value
 * 输出 / Returns: `( (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) && …`; `false`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return false;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return false;`; these statements determine whether a failure is absorbed or rejected again.
 */
export const dependencyEndpoint = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      const decodedPath = decodeURIComponent(url.pathname);
      return (
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        !/[\s\x00-\x1f\\]/.test(value) &&
        !/%(?:25|2f|5c|00|0a|0d)/i.test(url.pathname) &&
        !/[\x00-\x1f\x7f\\;]/.test(decodedPath)
      );
    } catch {
      return false;
    }
  }, '认证下载需要不含凭证或查询参数的 HTTPS 地址；HTTP 仅用于客户机回环地址');

export const dependencyAuthentication = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bearer'), endpoint: dependencyEndpoint, tokenSecret: secretName }).strict(),
  z
    .object({
      kind: z.literal('basic'),
      endpoint: dependencyEndpoint,
      username: z
        .string()
        .min(1)
        .max(256)
        .regex(/^[^:\x00-\x1f\x7f]+$/),
      passwordSecret: secretName,
    })
    .strict(),
]);
export const dependencyDownloadsSchema = z
  .object({
    npm: dependencyAuthentication.optional(),
    pip: dependencyAuthentication.optional(),
    git: dependencyAuthentication.optional(),
  })
  .strict();
export type DependencyAuthentication = z.infer<typeof dependencyAuthentication>;
export type ResolvedDependencyAuthentication = {
  endpoint: string;
  authorization: string;
  privateValues: string[];
};

/**
 * 入口 / Entry: resolveDependencyAuthentication.
 * 功能：在解析依赖下载凭证并部署临时认证代理中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ endpoint, authorization, privateValues: [value, authorization, authorization.split(' ')[1], encodeURIComponent(value)], }` 供上层消费（`dependency-downloads.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `dependency-downloads.ts`; this entry produces `{ endpoint, authorization, privateValues: [value, authorization, authorization.split(' ')[1], encodeURIComponent(value)], }` for its caller. Module context: Resolves dependency credentials and installs temporary brokers; cleanup pins the original path and guest boot identity.
 * 处理：通过 `dependencyAuthentication.parse`, `secrets.value`, `inline.test`, `authorization.split` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `dependencyAuthentication.parse`, `secrets.value`, `inline.test`, `authorization.split`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string; input: DependencyAuthentication; secrets: SecretsV1 optional
 * 输出 / Returns: Promise<ResolvedDependencyAuthentication>；结果来自 / values from `{ endpoint, authorization, privateValues: [value, authorization, authorization.split(' ')[1], encodeURIComponent(value)], }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!secrets`; `!value || /[\x00-\x1f\x7f]/.test(value) || (config.kind === 'bearer' && !/^[\x21-\x7e]+$/.test(value))`; `Buffer.byteLength(JSON.stringify({ endpoint, authorization }), 'utf8') > 16384`; 异常 / errors `new AppError('认证依赖预取需要启用私密配置插件', 409)`; `new AppError('下载凭证包含不支持的字符', 409)`.
 */
export async function resolveDependencyAuthentication(
  id: string,
  input: DependencyAuthentication,
  secrets?: SecretsV1,
): Promise<ResolvedDependencyAuthentication> {
  const config = dependencyAuthentication.parse(input);
  if (!secrets) throw new AppError('认证依赖预取需要启用私密配置插件', 409);
  const name = config.kind === 'bearer' ? config.tokenSecret : config.passwordSecret;
  const value = await secrets.value(id, name);
  if (!value || /[\x00-\x1f\x7f]/.test(value) || (config.kind === 'bearer' && !/^[\x21-\x7e]+$/.test(value)))
    throw new AppError('下载凭证包含不支持的字符', 409);
  const authorization =
    config.kind === 'bearer'
      ? `Bearer ${value}`
      : `Basic ${Buffer.from(config.username + ':' + value, 'utf8').toString('base64')}`;
  const endpoint = new URL(config.endpoint).href;
  if (Buffer.byteLength(JSON.stringify({ endpoint, authorization }), 'utf8') > 16384)
    throw new AppError('下载凭证超过认证下载器支持的长度', 409);
  return {
    endpoint,
    authorization,
    privateValues: [value, authorization, authorization.split(' ')[1], encodeURIComponent(value)],
  };
}

let source: Promise<string> | undefined;
/**
 * 入口 / Entry: dependencyBrokerSource.
 * 功能：在解析依赖下载凭证并部署临时认证代理中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(source ||= readFile(join(ROOT, 'server', 'dependency-download-broker.py'), 'utf8').catch( (error) => { if (error.code !== 'E…` 供上层消费（`dependency-downloads.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `dependency-downloads.ts`; this entry produces `(source ||= readFile(join(ROOT, 'server', 'dependency-download-broker.py'), 'utf8').catch( (error) => { if (error.code !== 'E…` for its caller. Module context: Resolves dependency credentials and installs temporary brokers; cleanup pins the original path and guest boot identity.
 * 处理：通过 `readFile().catch`, `readFile`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `readFile().catch`, `readFile`, `join`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `(source ||= readFile(join(ROOT, 'server', 'dependency-download-broker.py'), 'utf8').catch( (error) => { if (error.code !== 'E…`.
 * 副作用 / Effects: 更新 / updates `source`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function dependencyBrokerSource() {
  return (source ||= readFile(join(ROOT, 'server', 'dependency-download-broker.py'), 'utf8').catch(
    (error) => {
      if (error.code !== 'ENOENT') throw error;
      return readFile(join(ROOT, '.sakura-server', 'assets', 'dependency-download-broker.py'), 'utf8');
    },
  ));
}

/** Credentials travel over SFTP, never in an SSH command, child argv or environment. */
/**
 * 入口 / Entry: withDependencyAuthentication.
 * 功能：在解析依赖下载凭证并部署临时认证代理中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await work({ credentialFile, brokerFile })` 供上层消费（`dependency-downloads.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `dependency-downloads.ts`; this entry produces `await work({ credentialFile, brokerFile })` for its caller. Module context: Resolves dependency credentials and installs temporary brokers; cleanup pins the original path and guest boot identity.
 * 处理：通过 `signal.throwIfAborted`, `machines.live.get`, `randomBytes().toString`, `randomBytes` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `machines.live.get`, `randomBytes().toString`, `randomBytes`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `result?.code === 0`; `attempt < 2`.
 * 输入 / Inputs: machines: Machines; id: string; authentication: ResolvedDependencyAuthentication; signal: AbortSignal; work: (paths: { credentialFile: string; brokerFile: string }) => Promise<T>
 * 输出 / Returns: Promise<T>；结果来自 / values from `await work({ credentialFile, brokerFile })`.
 * 副作用 / Effects: `machines.exec`; `machines.exec().catch`; 更新 / updates `created`, `removed`.
 * 拒绝 / Refusals: 条件 / conditions `!instance`; `prepared.code !== 0`; `instance && machines.live.get(id) === instance`; 异常 / errors `new AppError('认证下载需要运行中的实例', 409)`; `new AppError('无法创建认证下载临时目录', 502)`.
 * 收尾：退出 try 区域时始终执行 `if (instance && machines.live.get(id) === instance) { const cleanup = `if [ -d ${quote(directory)} ]; then\n` + (created ? `r…`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `if (instance && machines.live.get(id) === instance) { const cleanup = `if [ -d ${quote(directory)} ]; then\n` + (created ? `r…`; these steps also apply to exceptional exits.
 */
export async function withDependencyAuthentication<T>(
  machines: Machines,
  id: string,
  authentication: ResolvedDependencyAuthentication,
  signal: AbortSignal,
  work: (paths: { credentialFile: string; brokerFile: string }) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const instance = machines.live.get(id);
  if (!instance) throw new AppError('认证下载需要运行中的实例', 409);
  // Select the exact exclusive path before SSH. A lost mkdir receipt must not
  // make its empty protected directory impossible to identify and clean.
  const directory = '/run/sakura-dependency-auth.' + randomBytes(16).toString('hex');
  const credentialFile = directory + '/credential.json',
    brokerFile = directory + '/broker.py';
  let created = false;
  try {
    const prepared = await machines.exec(
      id,
      `umask 077; mkdir -m 700 -- ${quote(directory)}`,
      10_000,
      signal,
    );
    if (prepared.code !== 0) throw new AppError('无法创建认证下载临时目录', 502);
    created = true;
    const broker = await dependencyBrokerSource();
    /**
     * 入口 / Entry: withDependencyAuthentication.callback@135.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（machines.sftp）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (machines.sftp).
     * 输入 / Inputs: ftp; transport
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `AbortSignal.any`; `ftp.createWriteStream`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    await machines.sftp(
      id,
      async (ftp, transport) => {
        const combined = transport ? AbortSignal.any([transport, signal]) : signal;
        for (const [file, text] of [
          [
            credentialFile,
            JSON.stringify({
              endpoint: authentication.endpoint,
              authorization: authentication.authorization,
            }),
          ],
          [brokerFile, broker],
        ]) {
          combined.throwIfAborted();
          await pipeline(
            Readable.from([Buffer.from(text)]),
            ftp.createWriteStream(file, { flags: 'wx', mode: 0o600 }),
            { signal: combined },
          );
        }
      },
      signal,
    );
    signal.throwIfAborted();
    return await work({ credentialFile, brokerFile });
  } finally {
    // /run is replaced on guest reboot. Never clean a newly started instance's paths.
    if (instance && machines.live.get(id) === instance) {
      const cleanup =
        `if [ -d ${quote(directory)} ]; then\n` +
        (created ? `rm -f -- ${quote(credentialFile)} ${quote(brokerFile)}\n` : '') +
        `rmdir -- ${quote(directory)}\nfi`;
      let removed = false;
      for (let attempt = 0; attempt < 3 && machines.live.get(id) === instance; attempt++) {
        const result = await machines.exec(id, cleanup, 10_000).catch(() => undefined);
        if (result?.code === 0) {
          removed = true;
          break;
        }
        if (attempt < 2) await delay(200);
      }
      if (!removed && machines.live.get(id) === instance)
        throw new AppError('认证下载临时目录未能清理；请恢复实例连接后重试', 502);
    }
  }
}
