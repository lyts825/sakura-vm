/** 数据目录归属锁的子进程夹具；通过独立进程持锁，供父测试核对竞争与退出后的释放。 */
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
