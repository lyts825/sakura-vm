/** 定义的修订检查、复制、归档和导入预览；执行由独立领域服务负责。
 * Manage revisioned definitions; execution remains in the dedicated domain services. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import {
  deliveryDefinitionSchema,
  deliveryScopeSchema,
  type DeliveryScope,
} from '../shared/contracts/delivery-common.ts';
import {
  deliveryDefinitionRecordSchema,
  deliveryDefinitionSaveSchema,
  deliveryTemplates,
  type DeliveryDefinitionRecord,
} from '../shared/contracts/delivery-workbench.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { DeliveryWorkbenchV1 } from './service-contracts/delivery-workbench.ts';
const indexSchema = z
  .object({ schemaVersion: z.literal(1), definitions: z.array(deliveryDefinitionRecordSchema).max(5000) })
  .strict();
/** 同时比较 VM 和项目身份。 Compare both VM and project identity. */
const same = (a: DeliveryScope, b: DeliveryScope) => a.vmId === b.vmId && a.projectId === b.projectId;
export class DeliveryWorkbench implements DeliveryWorkbenchV1 {
  private tail: Promise<unknown> = Promise.resolve();
  /** 绑定持久元数据及每次操作的准入检查，不在构造时读写数据。
   * Bind persistent metadata and per-operation authorization without reading or writing yet. */
  constructor(
    private metadata: PluginMetadata,
    private authorize: (scope: DeliveryScope) => Promise<void>,
  ) {}
  /** 返回指定项目的定义和模板；损坏索引拒绝读取。
   * Return scoped definitions and templates, rejecting a corrupt index. */
  async view(scope: DeliveryScope) {
    deliveryScopeSchema.parse(scope);
    await this.authorize(scope);
    const state = indexSchema.parse((await this.metadata.read()).value);
    return {
      definitions: state.definitions.filter((value) => same(value.scope, scope)),
      templates: structuredClone(deliveryTemplates),
    };
  }
  /** 串行变更索引，排队后与提交前复核授权；修订冲突不覆盖其他写入。
   * Serialize index mutations, recheck authorization after queueing and before commit, and preserve conflicting writes. */
  private write<T>(scope: DeliveryScope, mutate: (records: DeliveryDefinitionRecord[]) => T): Promise<T> {
    deliveryScopeSchema.parse(scope);
    const operation = this.tail.then(async () => {
      await this.authorize(scope);
      const snapshot = await this.metadata.read();
      const state = indexSchema.parse(snapshot.value),
        result = mutate(state.definitions);
      await this.metadata.replace(indexSchema.parse(state), {
        expectedRevision: snapshot.revision,
        beforeCommit: () => this.authorize(scope),
      });
      return result;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  /** 按预期修订创建或更新定义，返回已持久化的新修订。
   * Create or update a definition using its expected revision and return the persisted revision. */
  async save(scope: DeliveryScope, value: z.infer<typeof deliveryDefinitionSaveSchema>) {
    const input = deliveryDefinitionSaveSchema.parse(value);
    return this.write(scope, (records) => {
      const prior = input.id
        ? records.find((record) => record.id === input.id && same(record.scope, scope))
        : undefined;
      if (input.id && !prior) throw new AppError('交付定义不存在', 404);
      if ((prior?.revision ?? 0) !== input.expectedRevision)
        throw new AppError('定义已变化，请重新读取后保存', 409);
      const now = new Date().toISOString();
      const record = deliveryDefinitionRecordSchema.parse({
        id: prior?.id ?? randomUUID(),
        scope,
        revision: (prior?.revision ?? 0) + 1,
        definition: input.definition,
        archived: false,
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
      });
      if (prior) records.splice(records.indexOf(prior), 1, record);
      else records.push(record);
      return record;
    });
  }
  /** 核对项目及修订后归档，保留定义内容和历史身份。
   * Archive after checking scope and revision, retaining definition content and identity. */
  async archive(scope: DeliveryScope, id: string, expectedRevision: number) {
    return this.write(scope, (records) => {
      const record = records.find((value) => value.id === id && same(value.scope, scope));
      if (!record) throw new AppError('交付定义不存在', 404);
      if (record.revision !== expectedRevision) throw new AppError('定义已变化，请刷新后归档', 409);
      record.archived = true;
      record.revision++;
      record.updatedAt = new Date().toISOString();
      return record;
    });
  }
  /** 将当前项目的定义复制为新身份，不复制运行或证据。
   * Copy a scoped definition under a fresh identity without copying runs or evidence. */
  async copy(scope: DeliveryScope, id: string) {
    const record = (await this.view(scope)).definitions.find((value) => value.id === id);
    if (!record) throw new AppError('交付定义不存在', 404);
    return this.save(scope, {
      expectedRevision: 0,
      definition: { ...record.definition, name: record.definition.name.slice(0, 110) + ' 副本' },
    });
  }
  /** 有界解析外部 JSON 并返回定义；预览不保存或执行内容。
   * Parse bounded external JSON into a definition without saving or executing it. */
  async previewImport(scope: DeliveryScope, text: string) {
    await this.authorize(scope);
    if (Buffer.byteLength(text) > 1024 * 1024) throw new AppError('定义文件不得超过 1 MiB', 413);
    return deliveryDefinitionSchema.parse(JSON.parse(text));
  }
}
