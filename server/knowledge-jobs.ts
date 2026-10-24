/** 可取消任务日志；重启只标记中断，不重放业务。 Cancellable task receipts; restart never replays work. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import * as K from '../shared/contracts/knowledge-studio.ts';
import { KnowledgeStore, now, fail, type KnowledgeAuthorize } from './knowledge-store.ts';
import type { KnowledgeSourcesV1 } from './service-contracts/knowledge-studio.ts';
const rowSchema = K.jobSchema.extend({ revision: z.literal(1) }).strict();
export class KnowledgeJobs {
  private store: KnowledgeStore<z.infer<typeof rowSchema>>;
  private live = new Map<string, { controller: AbortController; done: Promise<unknown> }>();
  private abort = new AbortController();
  private recovered = false;
  constructor(meta: PluginMetadata, auth: KnowledgeAuthorize, sources: KnowledgeSourcesV1) {
    this.store = new KnowledgeStore(meta, rowSchema, auth, sources);
  }
  async list(spaceId: string) {
    if (!this.recovered) {
      await this.store.change(
        spaceId,
        (rows) => {
          for (const r of rows)
            if (r.state === 'running') {
              r.state = 'interrupted';
              r.error = '进程中断；请重新预览并显式重试';
            }
        },
        true,
      );
      this.recovered = true;
    }
    return (await this.store.list(spaceId)).map(({ revision, ...r }) => K.jobSchema.parse(r));
  }
  async run<T>(
    spaceId: string,
    kind: string,
    work: (signal: AbortSignal) => Promise<T>,
    external?: AbortSignal,
  ) {
    await this.list(spaceId);
    if (this.live.size >= 2) fail('KNOWLEDGE_BUSY', '每领域最多 2 个重任务');
    const id = randomUUID(),
      controller = new AbortController(),
      signal = AbortSignal.any([controller.signal, this.abort.signal, ...(external ? [external] : [])]);
    await this.store.append({
      id,
      spaceId,
      revision: 1,
      kind,
      state: 'running',
      createdAt: now(),
      error: '',
    });
    const done = (async () => {
      try {
        const result = await work(signal);
        signal.throwIfAborted();
        await this.store.change(
          spaceId,
          (rows) => {
            rows.find((r) => r.id === id)!.state = 'ready';
          },
          true,
        );
        return result;
      } catch (e) {
        await this.store.change(
          spaceId,
          (rows) => {
            const r = rows.find((r) => r.id === id)!;
            r.state =
              (e as { code?: string }).code === 'COMPUTE_CLEANUP_PENDING'
                ? 'cleanup-pending'
                : signal.aborted
                  ? 'cancelled'
                  : 'failed';
            r.error = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
          },
          true,
        );
        throw e;
      } finally {
        this.live.delete(id);
      }
    })();
    this.live.set(id, { controller, done });
    return done;
  }
  async cancel(spaceId: string, id: string) {
    const job = (await this.list(spaceId)).find((j) => j.id === id);
    if (!job) fail('KNOWLEDGE_NOT_FOUND', '任务不存在', 404);
    const active = this.live.get(id);
    if (active) {
      active.controller.abort(new Error('用户取消'));
      await active.done.catch(() => {});
    }
    return (await this.list(spaceId)).find((j) => j.id === id)!;
  }
  async close() {
    this.abort.abort();
    await Promise.allSettled([...this.live.values()].map((v) => v.done));
    await this.store.close();
  }
}
