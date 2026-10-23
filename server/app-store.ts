/** 应用各领域独立持久存储；严格解析、串行 CAS 与提交前授权。 */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import { AppError } from '../shared/errors.ts';
import { appIdSchema, appViewSchema, type AppView } from '../shared/contracts/app-runtime.ts';
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
export const appHash = (value: unknown) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(canonical(value)))
    .digest('hex');
export const appNow = () => new Date().toISOString();
export const appNewId = () => randomUUID();
export const appView = (value: Partial<AppView>): AppView => appViewSchema.parse(value);
export class AppStore<T extends { appId: string }> {
  private queue: Promise<unknown> = Promise.resolve();
  private schema;
  constructor(
    private metadata: PluginMetadata,
    row: z.ZodType<T>,
    private authorize: () => void | Promise<void>,
  ) {
    this.schema = z.object({ schemaVersion: z.literal(1), rows: z.array(row).max(10000) }).strict();
  }
  async read(appId?: string) {
    await this.authorize();
    if (appId) appIdSchema.parse(appId);
    const state = this.schema.parse((await this.metadata.read()).value);
    return structuredClone(state.rows.filter((v) => !appId || v.appId === appId));
  }
  write<R>(mutate: (rows: T[]) => R | Promise<R>): Promise<R> {
    const next = this.queue
      .catch(() => {})
      .then(async () => {
        await this.authorize();
        const saved = await this.metadata.read();
        const state = this.schema.parse(saved.value);
        const result = await mutate(state.rows);
        if (Buffer.byteLength(JSON.stringify(state)) > 32 * 1024 ** 2)
          throw new AppError('应用档案超过容量上限', 413);
        await this.metadata.replace(this.schema.parse(state), {
          expectedRevision: saved.revision,
          beforeCommit: this.authorize,
        });
        return result;
      });
    this.queue = next;
    return next;
  }
}
export const appRequire = <T>(value: T | undefined, message: string): T => {
  if (!value) throw new AppError(message, 404);
  return value;
};
