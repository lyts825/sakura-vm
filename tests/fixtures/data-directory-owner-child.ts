/**
 * 模块职责：共享测试夹具模块，围绕 `fixtures/data-directory-owner-child` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Shared test fixture for `fixtures/data-directory-owner-child`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 */
import { DataDirectoryOwner } from '../../server/data-directory-owner.ts';

try {
  const owner = await DataDirectoryOwner.acquire(process.argv[2]);
  process.on('message', async () => {
    await owner.close();
    process.disconnect?.();
  });
  process.send?.({ ready: true });
} catch (error) {
  process.send?.({ error: (error as Error & { code?: string }).code });
  process.disconnect?.();
}
