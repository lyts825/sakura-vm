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
  '.sakura-witness/docs/ha-witness-maintenance.md',
  '.sakura-server/assets/state-report.sh', '.sakura-server/assets/engineering-runner.py',
  '.sakura-server/assets/secure-erase.py', '.sakura-server/assets/dependency-download-broker.py',
  '.sakura-server/assets/project-repository-broker.py'])
  await stat(join(root, file));
if (process.platform === 'win32') {
  const folder = join(root, '.sakura-server', 'assets', 'native-clipboard');
  const native = JSON.parse(await readFile(join(folder, 'native-clipboard.json'), 'utf8'));
  const names = ['SakuraClipboardPolicy.dll', 'sakura-clipboard-controller.exe', 'SakuraClipboardPolicy-x86.dll', 'sakura-clipboard-controller-x86.exe', 'MinHook-LICENSE.txt', 'Detours-LICENSE.md'];
  if (native.version !== 7 || native.architecture !== 'x64' || !/^[a-f0-9]{64}$/.test(native.build) ||
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
{
  const folder = join(root, '.sakura-server/assets/wayland-clipboard');
  const native = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  const sources = JSON.parse(await readFile(join(folder, 'sources.json'), 'utf8'));
  const names = ['controller.py', 'proxy.py', 'sources.json', ...sources.files.map(file => file.name)];
  const build = createHash('sha256');
  if (native.version !== 1 || sources.version !== 1 || !/^[a-f0-9]{64}$/.test(native.build) ||
      names.length !== 20 || new Set(names).size !== 20 || !Array.isArray(native.files) || native.files.length !== 20)
    throw new Error('Wayland clipboard source metadata is invalid');
  for (const name of names) {
    if (!/^[a-z0-9-]+\.(py|json|xml)$/.test(name)) throw new Error('Wayland asset name is invalid');
    const file = native.files.find(file => file.name === name), bytes = await readFile(join(folder, name));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (!file || file.size !== bytes.length || file.sha256 !== sha256)
      throw new Error(`Wayland clipboard source integrity failed: ${name}`);
    const original = sources.files.find(file => file.name === name);
    if (original && (original.size !== bytes.length || original.sha256 !== sha256))
      throw new Error(`Pinned Wayland protocol integrity failed: ${name}`);
    build.update(name).update(bytes);
  }
  if (build.digest('hex') !== native.build) throw new Error('Wayland clipboard source build digest failed');
}
{
  const folder = join(root, '.sakura-server/assets/project-identity');
  const native = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  const names = ['protocol.h', 'launcher.c', 'controller.py'], build = createHash('sha256');
  if (native.version !== 1 || !/^[a-f0-9]{64}$/.test(native.build) || !Array.isArray(native.files) ||
      native.files.length !== names.length || new Set(native.files.map(file => file.name)).size !== names.length)
    throw new Error('Project identity source metadata is invalid');
  for (const name of names) {
    const file = native.files.find(file => file.name === name), bytes = await readFile(join(folder, name));
    if (!file || file.size !== bytes.length || file.sha256 !== createHash('sha256').update(bytes).digest('hex'))
      throw new Error(`Project identity source integrity failed: ${name}`);
    build.update(name).update(bytes);
  }
  if (build.digest('hex') !== native.build) throw new Error('Project identity source build digest failed');
}
{
  const folders = ['ssh-agent', 'gpg-agent'];
  for (const name of folders) {
    const folder = join(root, '.sakura-server/assets', name);
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
    if (manifest.version !== 1 || manifest.file !== 'broker.py' ||
        !Number.isSafeInteger(manifest.size) || manifest.size < 1 || manifest.size > 262144 ||
        !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
        Object.keys(manifest).sort().join(',') !== 'file,sha256,size,version')
      throw new Error(`${name} source metadata is invalid`);
    const bytes = await readFile(join(folder, manifest.file));
    if (bytes.length !== manifest.size || createHash('sha256').update(bytes).digest('hex') !== manifest.sha256)
      throw new Error(`${name} source integrity failed`);
  }
}
const extensionRoot = join(root, 'browser-extension');
{
  const folder = join(root, '.sakura-server/assets/single-app');
  const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  const names = ['controller.py', 'directory-view.py', 'sources.json'], build = createHash('sha256');
  if (manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.build) || !Array.isArray(manifest.files) ||
      manifest.files.length !== names.length || !manifest.files.every((file, index) => file.name === names[index]))
    throw new Error('Single-app source metadata is invalid');
  for (const name of names) {
    const expected = manifest.files.find(file => file.name === name), bytes = await readFile(join(folder, name));
    if (!expected || expected.size !== bytes.length || expected.sha256 !== createHash('sha256').update(bytes).digest('hex'))
      throw new Error(`Single-app source integrity failed: ${name}`);
    build.update(name).update(bytes);
  }
  if (build.digest('hex') !== manifest.build) throw new Error('Single-app source build digest failed');
}
if (process.platform === 'win32') {
  const folder = join(root, '.sakura-server/assets/gpg-agent-host');
  const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  const expectedKeys = ['version', 'platform', 'architecture', 'protocol', 'file', 'size', 'sha256', 'sourceSha256', 'compilerSha256'];
  if (Object.keys(manifest).sort().join(',') !== expectedKeys.sort().join(',') ||
      manifest.version !== 1 || manifest.protocol !== 1 || manifest.platform !== 'win32' ||
      manifest.architecture !== 'x64' || manifest.file !== 'relay.exe' ||
      !Number.isSafeInteger(manifest.size) || manifest.size < 1 || manifest.size > 16777216 ||
      !['sha256', 'sourceSha256', 'compilerSha256'].every(key => /^[a-f0-9]{64}$/.test(manifest[key])))
    throw new Error('GPG host helper metadata is invalid');
  const bytes = await readFile(join(folder, manifest.file));
  const source = await readFile(join(root, '.sakura-server/assets/gpg-agent-host-source.cpp'));
  if (bytes.length !== manifest.size || createHash('sha256').update(bytes).digest('hex') !== manifest.sha256 ||
      createHash('sha256').update(source).digest('hex') !== manifest.sourceSha256)
    throw new Error('GPG host helper byte integrity failed');
  const pe = bytes.length >= 128 && bytes.toString('ascii', 0, 2) === 'MZ' ? bytes.readUInt32LE(0x3c) : 0;
  if (pe < 64 || pe + 26 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550 ||
      bytes.readUInt16LE(pe + 4) !== 0x8664 || bytes.readUInt16LE(pe + 24) !== 0x20b)
    throw new Error('GPG host helper PE architecture is invalid');
}
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
