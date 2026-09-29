import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { haHttpsRequest } from './ha-witness-http.ts';
import { haWitnessHeartbeatSchema, haWitnessIdentitySchema } from './ha-witness-core.ts';
import { AppError } from './model.ts';

export const haWitnessClientConfigSchema = z.object({
  version: z.literal(1),
  url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && url.pathname === '/' && !url.search &&
      !url.hash && !url.username && !url.password;
  }),
  fingerprint: z.string().regex(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/),
  token: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type HaWitnessClientConfig = z.infer<typeof haWitnessClientConfigSchema>;

export class HaWitnessClient {
  constructor(private config: HaWitnessClientConfig) {
    this.config = haWitnessClientConfigSchema.parse(config);
  }

  static async fromEnv() {
    const path = process.env.SAKURA_HA_WITNESS_CONFIG_FILE;
    if (!path) return null;
    return new HaWitnessClient(JSON.parse(await readFile(path, 'utf8')));
  }

  private async call(path: string, input: unknown) {
    return haHttpsRequest(new URL(path, this.config.url).toString(), 'POST', input,
      { bearer: this.config.token, fingerprint: this.config.fingerprint });
  }

  async heartbeat(input: unknown) {
    const value = haWitnessHeartbeatSchema.parse(input);
    const result = await this.call('/v1/heartbeat', value) as {
      armed?: boolean; phase?: string };
    if (result?.phase !== 'source' || typeof result.armed !== 'boolean')
      throw new AppError('见证心跳响应无效', 502);
    return { armed: result.armed };
  }

  async authorizeStart(input: unknown) {
    const value = haWitnessIdentitySchema.parse(input);
    const result = await this.call('/v1/authorize-start', value) as {
      allowed?: boolean; phase?: string };
    if (result?.allowed !== true || result.phase !== 'source')
      throw new AppError('见证节点未授权来源启动', 409, 'HA_WITNESS_FENCED');
  }

  async status(input: unknown) {
    const value = haWitnessIdentitySchema.parse(input);
    const result = await this.call('/v1/status', value) as {
      phase?: string; armed?: boolean; lastHeartbeatAt?: number;
      targetVmId?: string | null; targetHostId?: string;
      failureThreshold?: number; error?: string | null };
    if (!['source', 'fencing', 'fenced', 'promoted'].includes(result?.phase || '') ||
        typeof result.armed !== 'boolean' ||
        !z.uuid().safeParse(result.targetHostId).success ||
        !z.number().int().min(2).max(10).safeParse(result.failureThreshold).success)
      throw new AppError('见证状态响应无效', 502);
    return result;
  }

  async rejoin(input: unknown) {
    const value = haWitnessIdentitySchema.safeExtend({
      dataReconciled: z.literal(true),
    }).parse(input);
    const result = await this.call('/v1/rejoin', value) as {
      released?: boolean; retiredRemoteVmId?: string };
    if (result?.released !== true || !z.uuid().safeParse(result.retiredRemoteVmId).success)
      throw new AppError('见证退出接管响应无效', 502);
    return result;
  }
}
