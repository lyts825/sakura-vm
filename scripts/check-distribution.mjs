import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
for (const name of ['tsx', 'vite', 'react', 'react-dom', '@xterm/xterm', '@novnc/novnc'])
  if (Object.hasOwn(manifest.dependencies, name)) throw new Error(`${name} should only be needed to build the release`);
for (const file of ['dist/index.html', '.sakura-server/index.js', '.sakura-server/assets/state-report.sh'])
  await stat(join(root, file));
const jsFiles = [];
async function collect(folder) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, item.name);
    if (item.isDirectory()) await collect(path);
    else if (item.name.endsWith('.js')) jsFiles.push(path);
  }
}
await collect(join(root, '.sakura-server'));
for (const file of jsFiles) {
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (checked.status !== 0) throw new Error(`Invalid release JavaScript: ${file}\n${checked.stderr}`);
}
const html = await readFile(join(root, 'dist', 'index.html'), 'utf8');
const entry = /src="\/assets\/(index-[^/" ]+\.js)"/.exec(html)?.[1];
if (!entry) throw new Error('Frontend entry bundle is missing');
const bytes = (await stat(join(root, 'dist', 'assets', entry))).size;
if (bytes > 450_000) throw new Error(`Frontend entry exceeds 450 KB: ${bytes}`);
console.log(`Distribution checked: ${jsFiles.length} server modules, ${bytes} byte frontend entry.`);
