/**
 * 模块职责：共享测试夹具模块，围绕 `support/fake-vm-network` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Shared test fixture for `support/fake-vm-network`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 */
import type { NetworkRuntime, VmNetworkLease } from '../../server/network/index.ts';

/** Unit fixtures run fake VM engines and must not start a real QEMU networking process. */
export const fakeVmNetwork: Pick<NetworkRuntime, 'attachVm'> = {
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: options。
   * 结果：返回分支计算值（`lease`），以 Promise 交付。
   * Result: Return the branch-computed value (`lease`) through a Promise.
   */
  async attachVm(options) {
    const abort = new AbortController();
    let connected = true;
    const lease: VmNetworkLease = {
      vmId: options.vmId, generation: options.generation,
      netdev: 'stream,id=sakura-net,server=off,addr.type=inet,addr.host=127.0.0.1,addr.port=1',
      signal: abort.signal,
      /**
       * 中文功能：读取夹具当前状态或暴露受控句柄，供断言观察。
       * English: Read current fixture state or expose a controlled handle for assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`connected`）。
       * Result: Return the branch-computed value (`connected`).
       */
      get connected() { return connected; },
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: value。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 状态影响 / State effects: `connected`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `abort.signal.throwIfAborted`.
       */
      async setConnected(value) { abort.signal.throwIfAborted(); connected = value; },
      policy: { isolated: options.isolated, ipv6: !options.isolated && options.ipv6 !== false,
        forwards: [{ host: options.sshPort, guest: 22 }, ...options.forwards] },
      /**
       * 中文功能：生成或核对本组验证所需的摘要与身份材料。
       * English: Generate or verify digest and identity material required by this suite.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 协作入口 / Collaborators: `abort.signal.throwIfAborted`.
       */
      async forward() { abort.signal.throwIfAborted(); },
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: generation。
       * 结果：返回分支计算值（`next`），以 Promise 交付。
       * Result: Return the branch-computed value (`next`) through a Promise.
       * 协作入口 / Collaborators: `abort.abort`, `fakeVmNetwork.attachVm`, `next.setConnected`.
       */
      async renew(generation) {
        abort.abort();
        const next = await fakeVmNetwork.attachVm({ ...options, generation });
        await next.setConnected(connected);
        return next;
      },
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 协作入口 / Collaborators: `abort.abort`.
       */
      async close() { abort.abort(); },
    };
    return lease;
  },
};
