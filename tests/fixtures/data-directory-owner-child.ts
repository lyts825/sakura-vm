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
