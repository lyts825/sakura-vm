import { X509Certificate } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import type { TLSSocket } from 'node:tls';
import { AppError } from './model.ts';

type HttpsOptions = {
  bearer?: string; basic?: { username: string; password: string };
  fingerprint?: string; ca?: Buffer; timeoutMs?: number; maxResponseBytes?: number;
};

/** Keep the authenticated HTTP status available without forwarding upstream bodies. */
export class HaWitnessHttpError extends AppError {
  constructor(readonly upstreamStatus: number) {
    super(`见证上游返回 HTTP ${upstreamStatus}`, 502);
  }
}

/** JSON/empty HTTPS request with bounded bodies and either PKI or an exact certificate pin. */
export function haHttpsRequest(urlText: string, method: 'GET' | 'POST',
  payload: unknown, options: HttpsOptions = {}): Promise<unknown> {
  const url = new URL(urlText);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new AppError('见证服务只接受不含 URL 凭据的 HTTPS 地址');
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  if (body && Buffer.byteLength(body) > 4096) throw new AppError('见证请求过大');
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method, agent: false, signal: AbortSignal.timeout(options.timeoutMs || 10_000),
      rejectUnauthorized: !options.fingerprint,
      ...(options.ca ? { ca: options.ca } : {}),
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json',
          'content-length': Buffer.byteLength(body) }),
        ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}),
        ...(options.basic ? { authorization: `Basic ${Buffer.from(
          `${options.basic.username}:${options.basic.password}`).toString('base64')}` } : {}),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > (options.maxResponseBytes || 64 * 1024))
          request.destroy(new AppError('见证响应过大', 502));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300)
            throw new HaWitnessHttpError(response.statusCode || 0);
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw ? JSON.parse(raw) : null);
        } catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    if (options.fingerprint) request.once('socket', (socket) => {
      socket.once('secureConnect', () => {
        try {
          const raw = (socket as TLSSocket).getPeerCertificate(true)?.raw;
          const cert = raw ? new X509Certificate(raw) : null;
          if (!cert || cert.fingerprint256 !== options.fingerprint ||
              Date.parse(cert.validFrom) > Date.now() ||
              Date.parse(cert.validTo) <= Date.now())
            throw new AppError('见证上游证书指纹无效', 409);
          request.end(body);
        } catch (error) { request.destroy(error as Error); }
      });
    });
    request.on('error', reject);
    if (!options.fingerprint) request.end(body);
  });
}
