/** 范围隔离的原子元数据存储；服务内串行化所有写操作。 Scope-isolated atomic metadata and serialized mutations. */
import { createHash } from 'node:crypto';
import type { PluginMetadata } from './plugin-metadata.ts';
import { AppError } from '../shared/errors.ts';
import { deliveryScopeSchema, type DeliveryScope } from '../shared/contracts/delivery-common.ts';
/** 对 value 的字节或 JSON 表示返回 SHA-256；对象键序保持调用方顺序。 Hash bytes or JSON of value, preserving caller object key order. */
export const qualityHash = (value: unknown) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
/** 比较 a、b 的实例和项目标识，返回是否同范围。 Return whether a and b identify the same VM and project. */
export const sameScope = (a: DeliveryScope, b: DeliveryScope) =>
  a.vmId === b.vmId && a.projectId === b.projectId;
export class DeliveryQualityStore<T> {
  private tail: Promise<unknown> = Promise.resolve();
  /** 绑定 metadata、初值、authorize 和 validate；构造时不读写。 Bind metadata, initial state, authorization and validation without constructor I/O. */
  constructor(
    private metadata: PluginMetadata,
    private initial: () => T,
    private authorize: (scope: DeliveryScope) => void | Promise<void>,
    private validate: (value: unknown) => T,
  ) {}
  /** 校验 scope 并返回隔离索引键。 Validate scope and return its isolated index key. */
  private key(scope: DeliveryScope) {
    deliveryScopeSchema.parse(scope);
    return qualityHash([scope.vmId, scope.projectId]);
  }
  /** 返回合法顶层索引的副本；损坏 value 拒绝重置。 Return a valid index copy; reject corrupt value instead of resetting it. */
  private index(value: unknown): Record<string, unknown> {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some((key) => !/^[a-f0-9]{64}$/.test(key))
    )
      throw new AppError('交付索引顶层结构损坏，拒绝重置或覆盖', 409);
    return structuredClone(value) as Record<string, unknown>;
  }
  /** 读取并校验 index[key]；只有键缺失时采用初值。 Validate index[key], using initial state only when the key is absent. */
  private scoped(index: Record<string, unknown>, key: string): T {
    return this.validate(Object.hasOwn(index, key) ? index[key] : this.initial());
  }
  /** 授权后返回 scope 的已校验状态，不修改存储。 Authorize and return validated state for scope without writing. */
  async read(scope: DeliveryScope): Promise<T> {
    await this.authorize(scope);
    const snapshot = await this.metadata.read(),
      index = this.index(snapshot.value);
    return this.scoped(index, this.key(scope));
  }
  /**
   * 在 scope 内串行运行 fn，提交校验后的状态并返回 fn 结果；失败向调用方传播。
   * Serialize fn within scope, commit validated state and return its result; propagate failures.
   * 设计 / Design：读取、回调和 CAS 写入共用队列，提交前再次授权；失败不阻塞后续任务。
   * Reads, callbacks and CAS writes share one queue; reauthorize before commit without poisoning later tasks.
   */
  mutate<R>(scope: DeliveryScope, fn: (state: T) => Promise<R> | R): Promise<R> {
    const operation = this.tail.then(async () => {
      await this.authorize(scope);
      const snapshot = await this.metadata.read(),
        index = this.index(snapshot.value);
      const key = this.key(scope),
        state = this.scoped(index, key),
        result = await fn(state);
      index[key] = this.validate(state);
      this.index(index);
      if (Buffer.byteLength(JSON.stringify(index)) > 32 * 1024 * 1024)
        throw new AppError('交付索引超限', 413);
      await this.authorize(scope);
      await this.metadata.replace(index, {
        expectedRevision: snapshot.revision,
        beforeCommit: () => this.authorize(scope),
      });
      return result;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
