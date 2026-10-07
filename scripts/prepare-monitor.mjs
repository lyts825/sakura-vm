/** 打包只读监控 PWA，计算静态壳版本并替换 service worker 的缓存修订占位符。
 * Copy the monitor PWA shell and bind worker cache revision to actual shell bytes for coherent offline updates. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), 'dist', 'monitor');
const hash = createHash('sha256');
for (const file of [
  'index.html',
  'monitor.js',
  'monitor.css',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'sw.js',
])
  hash.update(await readFile(join(root, file)));
const source = await readFile(join(root, 'sw.js'), 'utf8');
await writeFile(
  join(root, 'sw.js'),
  source.replaceAll('__MONITOR_REVISION__', hash.digest('hex').slice(0, 20)),
);
