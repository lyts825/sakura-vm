/**
 * 模块职责：共享测试夹具模块，围绕 `gpg-agent-fixture` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Shared test fixture for `gpg-agent-fixture`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 */
import { gpgHostSnapshotSha256, type GpgHostSnapshot } from '../server/gpg-agent-host.ts';

/** Synthetic metadata for task ownership tests; this does not attest a host Agent. */
/**
 * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
 * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `hostSourceSha256`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `hostSourceSha256`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `'a'.repeat`, `'c'.repeat`, `'b'.repeat`, `gpgHostSnapshotSha256`.
 */
export function syntheticGpgHostSnapshot(): GpgHostSnapshot {
  const owner = 'S-1-5-21-1-2-3-1001';
  const anchor = { id: '1:00000000000000000000000000000001', owner,
    aclSha256: 'a'.repeat(64), attributes: 16, links: 1, directory: true, protectedAcl: true };
  const leaf = { ...anchor, id: '1:00000000000000000000000000000002',
    attributes: 32, directory: false, protectedAcl: false };
  const value = { version: 1 as const, hostHelperSha256: 'c'.repeat(64), pins: {
    kind: 'w32' as const, anchorPath: 'D:\\private', relativePath: 'e', anchor,
    ancestors: [anchor], descendants: [leaf], sourceFileSha256: 'b'.repeat(64), port: 12345,
    process: { pid: 123, creationTime: '134353495574608003', sid: owner,
      image: 'D:\\private\\bin\\gpg-agent.exe' },
  } };
  return { ...value, hostSourceSha256: gpgHostSnapshotSha256(value) };
}
