/** 仅组合公共读取与保存向导偏好。 Composes public ports without copying domain objects. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import * as K from '../shared/contracts/knowledge-studio.ts';
import type {
  KnowledgeSourcesV1,
  KnowledgeExtractV1,
  KnowledgeIndexV1,
  KnowledgeEntriesV1,
  KnowledgeDocumentsV1,
  KnowledgeReviewsV1,
  KnowledgeWorkbenchV1,
} from './service-contracts/knowledge-studio.ts';
import { KnowledgeStore, type KnowledgeAuthorize } from './knowledge-store.ts';
const prefSchema = z
  .object({ id: K.kid, spaceId: K.kid, revision: z.number().int().positive(), step: z.string().max(80) })
  .strict();
export class KnowledgeWorkbench implements KnowledgeWorkbenchV1 {
  private store: KnowledgeStore<z.infer<typeof prefSchema>>;
  constructor(
    meta: PluginMetadata,
    private sources: KnowledgeSourcesV1,
    private extract: KnowledgeExtractV1,
    private index: KnowledgeIndexV1,
    private entries: KnowledgeEntriesV1,
    private documents: KnowledgeDocumentsV1,
    private reviews: KnowledgeReviewsV1,
    auth: KnowledgeAuthorize,
  ) {
    this.store = new KnowledgeStore(meta, prefSchema, auth, sources);
  }
  async view(input: { spaceId: string }) {
    const p = K.scopeSchema.parse(input);
    const space = await this.sources.space(p);
    const [sources, entries, documents, reviews, extractJobs, indexJobs, capacity] = await Promise.all([
      this.sources.listSources(p),
      this.entries.list(p),
      this.documents.list(p),
      this.reviews.list(p),
      this.extract.jobs(p),
      this.index.jobs(p),
      this.sources.capacity(p),
    ]);
    await this.sources.space(p);
    return { space, sources, entries, documents, reviews, jobs: [...extractJobs, ...indexJobs], capacity };
  }
  async preferences(input: { spaceId: string; step: string }) {
    const p = K.scopeSchema
      .extend({ step: z.string().min(1).max(80) })
      .strict()
      .parse(input);
    await this.sources.space({ spaceId: p.spaceId });
    await this.store.change(p.spaceId, (rows) => {
      const old = rows.find((r) => r.spaceId === p.spaceId);
      if (old) {
        old.step = p.step;
        old.revision++;
      } else rows.push({ id: randomUUID(), revision: 1, ...p });
    });
    return p;
  }
  async example(input: { name: string; template: K.Document['template'] }) {
    const p = z
      .object({ name: z.string().min(1).max(120), template: K.templateSchema })
      .strict()
      .parse(input);
    const space = await this.sources.createSpace({ name: p.name });
    const policy = { ...K.defaultPolicy, export: true };
    const materials = [
      [
        'README.md',
        '# 桜示例项目\n这是虚构的本地文档示例，无网络资源或真实凭据。\n适用版本：演示版 1。\n备份恢复前应验证备份摘要。\n',
      ],
      [
        '运行说明.md',
        '# 备份恢复\n恢复之前停止写入，验证备份摘要，然后在隔离目录验证内容。\n失败处理：停止操作，保留当前数据并人工检查。\n停止条件：摘要不一致。\n',
      ],
      ['旧决策.md', '# 待复核决策\n旧记录建议恢复前继续写入。此建议与运行说明冲突，需要人工判断。\n'],
    ];
    const sources: K.Source[] = [];
    for (const [name, text] of materials)
      sources.push(
        await this.sources.upload({
          spaceId: space.id,
          name,
          format: 'markdown',
          data: Buffer.from(text).toString('base64'),
          policy,
        }),
      );
    const first = sources[0];
    sources.push(
      await this.sources.upload({
        spaceId: space.id,
        sourceId: first.id,
        expectedRevision: 1,
        name: first.name,
        format: 'markdown',
        data: Buffer.from(materials[0][1] + '修订 2：增加交接检查，旧引用仍保留修订 1。\n').toString(
          'base64',
        ),
        policy,
      }),
    );
    return { space, sources };
  }
  close() {
    return this.store.close();
  }
}
