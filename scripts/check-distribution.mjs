import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
for (const name of ['tsx', 'vite', 'react', 'react-dom', '@xterm/xterm', '@novnc/novnc'])
  if (Object.hasOwn(manifest.dependencies, name)) throw new Error(`${name} should only be needed to build the release`);
for (const file of ['dist/index.html', 'dist/single-app.html', '.sakura-server/index.js',
  '.sakura-server/assets/state-report.sh', '.sakura-server/assets/engineering-runner.py',
  '.sakura-server/assets/secure-erase.py'])
  await stat(join(root, file));
const extensionRoot = join(root, 'browser-extension');
const extension = JSON.parse(await readFile(join(extensionRoot, 'manifest.json'), 'utf8'));
if (extension.manifest_version !== 3 || extension.action?.default_popup !== 'popup.html' ||
    extension.permissions?.join(',') !== 'storage' ||
    extension.host_permissions?.join(',') !== 'http://127.0.0.1/*')
  throw new Error('Browser extension manifest permissions changed unexpectedly');
for (const file of ['popup.html', 'popup.css', 'popup.js', 'background.js'])
  await stat(join(extensionRoot, file));
for (const file of ['popup.js', 'background.js']) {
  const checked = spawnSync(process.execPath, ['--check', join(extensionRoot, file)],
    { encoding: 'utf8' });
  if (checked.status !== 0) throw new Error(`Invalid browser extension JavaScript: ${file}`);
}
for (const file of ['scripts/sakura-tray.ps1', 'scripts/start-tray.mjs',
  'scripts/launch.mjs', 'scripts/wsl-runtime.mjs', 'scripts/self-update.mjs', 'scripts/release-manifest.mjs'])
  await stat(join(root, file));
for (const file of ['start-tray.mjs', 'launch.mjs', 'wsl-runtime.mjs', 'self-update.mjs', 'release-manifest.mjs']) {
  const checked = spawnSync(process.execPath, ['--check', join(root, 'scripts', file)],
    { encoding: 'utf8' });
  if (checked.status !== 0) throw new Error(`Invalid release script: ${file}`);
}
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
const singleAppHtml = await readFile(join(root, 'dist', 'single-app.html'), 'utf8');
const singleAppEntry = /src="\/assets\/([^/" ]+\.js)"/.exec(singleAppHtml)?.[1];
if (!singleAppEntry) throw new Error('Single-app window bundle is missing');
await stat(join(root, 'dist', 'assets', singleAppEntry));
const entry = /src="\/assets\/([^/" ]+\.js)"/.exec(html)?.[1];
if (!entry) throw new Error('Frontend entry bundle is missing');
const bytes = (await stat(join(root, 'dist', 'assets', entry))).size;
if (bytes > 450_000) throw new Error(`Frontend entry exceeds 450 KB: ${bytes}`);
console.log(`Distribution checked: ${jsFiles.length} server modules, ${bytes} byte frontend entry.`);
