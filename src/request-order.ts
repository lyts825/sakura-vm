/**
 * 模块职责（中文）：为并行或轮询读取记录发出/已应用顺序，防止迟到结果覆盖较新的已应用状态。
 * Module responsibility (English): Preventing late reads from replacing newer applied results.
 * 详细范围（中文）：公开入口包括 ResponseOrder；职责覆盖阻止迟到读取覆盖较新的已应用结果，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ResponseOrder. The scope covers Preventing late reads from replacing newer applied results. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
// Polling must make progress even when a request takes longer than its interval.
// A response is stale only after a newer response has been applied or its owner
// has invalidated the requests (for example, when leaving a VM).
export class ResponseOrder {
  private issued = 0;
  private applied = 0;

  /**
   * 中文：给新读取分配递增票号；只记录发出顺序，不提前废弃仍可能成为最新已完成结果的旧读取。
   * English: Allocate an increasing ticket for a new read; record issue order without prematurely excluding an older read that may still become the latest completed result.
   */
  start() {
    return ++this.issued;
  }

  /**
   * 中文：以已应用序号而非最新发出序号判断响应是否可接受，避免慢请求持续被轮询饿死；接受后记录该序号，晚于它返回的旧结果被拒绝。
   * English: Compare with the last applied sequence rather than the latest issued sequence so slow requests can still make progress under polling. Record accepted sequences and reject older results arriving later.
   * 中文：输入：version：读取票号、内容版本或契约版本
   * English: Inputs: version: read ticket/content/contract version
   */
  accept(version: number) {
    if (version < this.applied) return false;
    this.applied = version;
    return true;
  }

  /**
   * 中文：把已应用水位提高到新票号，围住写入、切换身份或手动失效前发出的所有读取；后续新读取仍可正常接受。
   * English: Advance the applied watermark to a new ticket, fencing all reads issued before a mutation, identity change or explicit invalidation while still admitting future reads.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  invalidate() {
    this.applied = ++this.issued;
  }
}
