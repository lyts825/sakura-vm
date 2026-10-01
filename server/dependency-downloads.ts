import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AppError, ROOT } from './model.ts';
import type { Machines } from './machines.ts';
import { secretName, type Secrets } from './secrets.ts';
import { quote } from './files.ts';

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
  })
  .strict();
export type DependencyAuthentication = z.infer<typeof dependencyAuthentication>;
export type ResolvedDependencyAuthentication = {
  endpoint: string;
  authorization: string;
  privateValues: string[];
};

export async function resolveDependencyAuthentication(
  id: string,
  input: DependencyAuthentication,
  secrets?: Secrets,
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
export function dependencyBrokerSource() {
  return (source ||= readFile(join(ROOT, 'server', 'dependency-download-broker.py'), 'utf8').catch(
    (error) => {
      if (error.code !== 'ENOENT') throw error;
      return readFile(join(ROOT, '.sakura-server', 'assets', 'dependency-download-broker.py'), 'utf8');
    },
  ));
}

/** Credentials travel over SFTP, never in an SSH command, child argv or environment. */
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
