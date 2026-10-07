/** 将来宾 SSH agent 辅助源码封装到服务器资源，记录逐文件身份供安装与执行校验。 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const bytes = await readFile(join(root, 'server', 'ssh-agent-broker.py'));
if (!bytes.length || bytes.length > 262144 || Buffer.from(bytes.toString('utf8'), 'utf8').compare(bytes) !== 0)
  throw new Error('SSH Agent broker source is invalid');
const target = join(root, '.sakura-server', 'assets', 'ssh-agent');
const manifest = { version: 1, file: 'broker.py', size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex') };
await mkdir(target, { recursive: true });
await writeFile(join(target, manifest.file), bytes);
await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
