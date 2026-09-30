import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
for (const name of ['tsx', 'vite', 'react', 'react-dom', '@xterm/xterm', '@novnc/novnc'])
  if (Object.hasOwn(manifest.dependencies, name)) throw new Error(`${name} should only be needed to build the release`);
for (const file of ['dist/index.html', 'dist/single-app.html', '.sakura-server/index.js',
  '.sakura-witness/ha-witness.js',
  '.sakura-server/assets/state-report.sh', '.sakura-server/assets/engineering-runner.py',
  '.sakura-server/assets/secure-erase.py'])
  await stat(join(root, file));
if (process.platform === 'win32') {
  const folder = join(root, '.sakura-server', 'assets', 'native-clipboard');
  const native = JSON.parse(await readFile(join(folder, 'native-clipboard.json'), 'utf8'));
  const names = ['SakuraClipboardPolicy.dll', 'sakura-clipboard-controller.exe', 'SakuraClipboardPolicy-x86.dll', 'sakura-clipboard-controller-x86.exe', 'MinHook-LICENSE.txt'];
  if (native.version !== 2 || native.architecture !== 'x64' || !/^[a-f0-9]{64}$/.test(native.build) ||
      !Array.isArray(native.files) || native.files.length !== names.length ||
      new Set(native.files.map((file) => file.name)).size !== names.length)
    throw new Error('Native clipboard distribution metadata is invalid');
  for (const name of names) {
    const file = native.files.find((file) => file.name === name), bytes = await readFile(join(folder, name));
    if (!file || file.size !== bytes.length || file.sha256 !== createHash('sha256').update(bytes).digest('hex'))
      throw new Error(`Native clipboard distribution integrity failed: ${name}`);
  }
}
{
  const folder = join(root, '.sakura-server/assets/linux-clipboard');
  const native = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  const names = ['protocol.h', 'policy.cpp', 'controller.py'], build = createHash('sha256');
  if (native.version !== 1 || !/^[a-f0-9]{64}$/.test(native.build) || !Array.isArray(native.files) || native.files.length !== 3 ||
      new Set(native.files.map(file => file.name)).size !== 3) throw new Error('Linux clipboard source metadata is invalid');
  for (const name of names) {
    const file = native.files.find(file => file.name === name), bytes = await readFile(join(folder, name));
    if (!file || file.size !== bytes.length || file.sha256 !== createHash('sha256').update(bytes).digest('hex'))
      throw new Error(`Linux clipboard source integrity failed: ${name}`);
    build.update(name).update(bytes);
  }
  if (build.digest('hex') !== native.build) throw new Error('Linux clipboard source build digest failed');
}
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
  'scripts/launch.mjs', 'scripts/launch-witness.mjs', 'scripts/wsl-runtime.mjs', 'scripts/self-update.mjs', 'scripts/release-manifest.mjs',
  'scripts/cli.mjs', 'scripts/guest-cli.mjs'])
  await stat(join(root, file));
for (const file of ['start-tray.mjs', 'launch.mjs', 'launch-witness.mjs', 'wsl-runtime.mjs', 'self-update.mjs', 'release-manifest.mjs',
  'cli.mjs', 'guest-cli.mjs']) {
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
await collect(join(root, '.sakura-witness'));
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
