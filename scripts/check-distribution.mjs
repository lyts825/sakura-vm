/** 验证实际发行目录、编译入口、运行依赖和原生资源摘要，确保安装布局无需源码即可运行。
 * Validate actual release layout, compiled entries, runtime dependencies and native-asset hashes so installed packages work without source code. */
import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
for (const file of ['sakura-sans-ui-OFL.txt', 'sakura-serif-ui-OFL.txt', 'sakura-mono-OFL.txt']) {
  const original = await readFile(join(root, 'src', 'assets', 'fonts', file));
  if (!original.equals(await readFile(join(root, 'dist', 'licenses', 'fonts', file))))
    throw new Error(`Runtime font license differs from its upstream copy: ${file}`);
}
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!Object.hasOwn(manifest.dependencies, 'undici'))
  throw new Error('Managed fetch requires the production undici dependency');
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
if (lock.packages?.['']?.dependencies?.undici !== manifest.dependencies.undici)
  throw new Error('Managed fetch production dependency differs from package-lock.json');
for (const name of ['tsx', 'vite', 'react', 'react-dom', '@xterm/xterm', '@novnc/novnc'])
  if (Object.hasOwn(manifest.dependencies, name))
    throw new Error(`${name} should only be needed to build the release`);
for (const file of [
  'dist/index.html',
  'dist/single-app.html',
  '.sakura-server/index.js',
  'scripts/trusted-update.mjs',
  'scripts/sign-release.mjs',
  'scripts/self-update.mjs',
  'scripts/release-manifest.mjs',
  'scripts/network-client.mjs',
  '.sakura-server/network-entry.js',
  '.sakura-server/compute-task.js',
  '.sakura-server/supply-offline.js',
  '.sakura-server/locale-offline.js',
  '.sakura-server/incident-offline.js',
  '.sakura-server/browser-offline.js',
  '.sakura-server/database-offline.js',
  '.sakura-server/event-offline.js',
  '.sakura-server/evaluation-offline.js',
  '.sakura-server/media-offline.js',
  '.sakura-server/flow-offline.js',
  '.sakura-server/learning-offline.js',
  '.sakura-server/assets/compute-worker.mjs',
  '.sakura-server/assets/compute-runtime.json',
  '.sakura-server/assets/network-worker.mjs',
  '.sakura-server/assets/bounded-qmp-policy.mjs',
  '.sakura-server/data-worker.py',
  '.sakura-server/integration-http-worker.py',
  '.sakura-server/drill-guest.py',
  '.sakura-server/assets/knowledge-worker.mjs',
  '.sakura-server/core-drill-validation-controller.mjs',
  '.sakura-server/assets/network-parent-exec.py',
  '.sakura-server/assets/network-runtime.json',
  '.sakura-server/docs/network-runtime.md',
  '.sakura-server/docs/delegated-actions.md',
  '.sakura-server/docs/incident-capture.md',
  '.sakura-witness/ha-witness.js',
  '.sakura-witness/docs/ha-witness-maintenance.md',
  '.sakura-server/assets/state-report.sh',
  '.sakura-server/assets/engineering-runner.py',
  '.sakura-server/assets/secure-erase.py',
  '.sakura-server/assets/dependency-download-broker.py',
  '.sakura-server/assets/project-repository-broker.py',
])
  await stat(join(root, file));
for (const file of ['integration-http-worker.py', 'drill-guest.py', 'drill-watchdog.cs', 'core-drill-validation-controller.mjs', 'suite-execution-guardian.py', 'suite-browser-worker.py', 'suite-database-worker.py', 'suite-event-worker.py', 'suite-media-worker.py', 'suite-learning-worker.py']) {
  const original = await readFile(join(root, 'server', file));
  if (!original.equals(await readFile(join(root, '.sakura-server', file))))
    throw new Error(`Fixed plugin worker differs from its source: ${file}`);
}
if (!(await readFile(join(root, 'server', 'browser-pixels-worker.mjs')))
    .equals(await readFile(join(root, '.sakura-server', 'assets', 'browser-pixels-worker.mjs'))))
  throw new Error('Packaged browser pixel worker differs from its source');
for (const file of ['browser-lab.md', 'database-evolution.md', 'event-lab.md', 'model-evaluation.md', 'media-studio.md', 'flow-studio.md', 'learning-lab.md', 'suite-execution.md', 'release-2.8.0.md'])
  if (!(await readFile(join(root, 'docs', file))).equals(await readFile(join(root, '.sakura-server', 'docs', file))))
    throw new Error(`Packaged suite guide differs from its source: ${file}`);
if (!(await readFile(join(root, 'server', 'knowledge-worker.mjs')))
    .equals(await readFile(join(root, '.sakura-server', 'assets', 'knowledge-worker.mjs'))))
  throw new Error('Packaged knowledge parser differs from its source');
if (process.platform === 'win32') {
  const folder = join(root, '.sakura-server', 'assets', 'resilience');
  const metadata = JSON.parse(await readFile(join(folder, 'drill-watchdog.json'), 'utf8'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  if (metadata.version !== 1 || metadata.digest !== hash(await readFile(join(folder, 'drill-watchdog.exe'))) ||
      metadata.sourceDigest !== hash(await readFile(join(folder, 'drill-watchdog.cs'))) ||
      metadata.sourceDigest !== hash(await readFile(join(root, 'server', 'drill-watchdog.cs'))))
    throw new Error('Packaged drill watchdog differs from the verified build inputs');
}
{
  const metadata = JSON.parse(await readFile(join(root, '.sakura-server/assets/compute-runtime.json'), 'utf8'));
  const files = ['compute-task.js', 'assets/compute-worker.mjs'];
  const sources = ['server/compute-task.ts', 'server/compute-worker.mjs', 'server/file-preview.ts',
    'server/file-preview-runtime.ts', 'server/compute-runtime.ts', 'server/suite-supply-analysis.ts', 'server/suite-locale-analysis.ts', 'server/suite-incident-analysis.ts', 'server/suite-incident-redaction.ts',
    'shared/contracts/supply-audit.ts', 'shared/contracts/locale-studio.ts', 'shared/contracts/incident-desk.ts', 'shared/contracts/incident-snapshots.ts', 'shared/contracts/cleanup-plan.ts', 'shared/contracts/resilience-lab.ts', 'shared/contracts/image-assets.ts', 'shared/contracts/drill-supervision.ts', 'shared/contracts/suite-common.ts', 'shared/suite-json.ts',
    'shared/errors.ts'];
  if (metadata.version !== 1 || !Array.isArray(metadata.files) || !Array.isArray(metadata.sources) ||
      metadata.files.map((entry) => entry.file).join(',') !== files.join(',') ||
      metadata.sources.map((entry) => entry.file).join(',') !== sources.join(','))
    throw new Error('Compute runtime asset metadata is invalid');
  for (const [base, entries] of [[join(root, '.sakura-server'), metadata.files], [root, metadata.sources]])
    for (const expected of entries) {
      const bytes = await readFile(join(base, expected.file));
      if (expected.size !== bytes.length || expected.sha256 !== createHash('sha256').update(bytes).digest('hex'))
        throw new Error(`Compute runtime asset is stale or damaged; rebuild: ${expected.file}`);
    }
  if (metadata.files[1].sha256 !== metadata.sources[1].sha256)
    throw new Error('Distributed compute worker differs from its source');
  // No tsx loader or source checkout is needed by the shipped entry point.
  const worker = new Worker(pathToFileURL(join(root, '.sakura-server/assets/compute-worker.mjs')), {
    execArgv: [], workerData: { task: 'file-preview', path: 'release.csv', size: 7, data: Buffer.from('a,b\n1,2') },
  });
  const timer = setTimeout(() => { void worker.terminate(); }, 10_000);
  try {
    const result = await new Promise((resolve, reject) => {
      worker.once('message', resolve); worker.once('error', reject);
      worker.once('exit', () => reject(new Error('Distributed compute worker exited without a result')));
    });
    if (!result?.ok || result.result?.kind !== 'table' || result.result.rows?.[1]?.[1] !== '2')
      throw new Error('Distributed compute worker returned an invalid result');
  } finally { clearTimeout(timer); await worker.terminate(); }
}
{
  const metadata = JSON.parse(
    await readFile(join(root, '.sakura-server/assets/network-runtime.json'), 'utf8'),
  );
  const sources = [
    'server/network-entry.ts',
    'server/network/core.ts',
    'server/network/index.ts',
    'server/network/host-pool.ts',
    'server/network/vm-backend.ts',
    'server/network/worker.mjs',
    'server/network/bounded-qmp-policy.mjs',
    'server/network/parent-exec.py',
  ];
  const files = ['network-entry.js', 'assets/network-worker.mjs', 'assets/bounded-qmp-policy.mjs', 'assets/network-parent-exec.py'];
  if (
    metadata.version !== 1 ||
    !Array.isArray(metadata.files) ||
    !Array.isArray(metadata.sources) ||
    metadata.files.map((entry) => entry.file).join(',') !== files.join(',') ||
    metadata.sources.map((entry) => entry.file).join(',') !== sources.join(',')
  )
    throw new Error('Network runtime asset metadata is invalid');
  for (const [base, entries] of [
    [join(root, '.sakura-server'), metadata.files],
    [root, metadata.sources],
  ]) {
    for (const expected of entries) {
      const bytes = await readFile(join(base, expected.file));
      if (
        expected.size !== bytes.length ||
        expected.sha256 !== createHash('sha256').update(bytes).digest('hex')
      )
        throw new Error(`Network runtime asset is stale or damaged; rebuild: ${expected.file}`);
    }
  }
  if (metadata.files[1].sha256 !== metadata.sources.find((item) => item.file === 'server/network/worker.mjs').sha256 ||
      metadata.files[2].sha256 !== metadata.sources.find((item) => item.file === 'server/network/bounded-qmp-policy.mjs').sha256 ||
      metadata.files[3].sha256 !== metadata.sources.find((item) => item.file === 'server/network/parent-exec.py').sha256)
    throw new Error('Distributed network worker differs from its source');
}
if (process.platform === 'win32') {
  const folder = join(root, '.sakura-server', 'assets', 'native-clipboard');
  const native = JSON.parse(await readFile(join(folder, 'native-clipboard.json'), 'utf8'));
  const names = [
    'SakuraClipboardPolicy.dll',
    'sakura-clipboard-controller.exe',
    'SakuraClipboardPolicy-x86.dll',
    'sakura-clipboard-controller-x86.exe',
    'MinHook-LICENSE.txt',
    'Detours-LICENSE.md',
  ];
  if (
    native.version !== 8 ||
    native.architecture !== 'x64' ||
    !/^[a-f0-9]{64}$/.test(native.build) ||
    !Array.isArray(native.files) ||
    native.files.length !== names.length ||
    new Set(native.files.map((file) => file.name)).size !== names.length
  )
    throw new Error('Native clipboard distribution metadata is invalid');
  for (const name of names) {
    const file = native.files.find((file) => file.name === name),
      bytes = await readFile(join(folder, name));
    if (
      !file ||
      file.size !== bytes.length ||
      file.sha256 !== createHash('sha256').update(bytes).digest('hex')
    )
      throw new Error(`Native clipboard distribution integrity failed: ${name}`);
  }
}
{
  const folder = join(root, '.sakura-server/assets/linux-clipboard');
  const native = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  const names = ['protocol.h', 'policy.cpp', 'controller.py'],
    build = createHash('sha256');
  if (
    native.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(native.build) ||
    !Array.isArray(native.files) ||
    native.files.length !== 3 ||
    new Set(native.files.map((file) => file.name)).size !== 3
  )
    throw new Error('Linux clipboard source metadata is invalid');
  for (const name of names) {
    const file = native.files.find((file) => file.name === name),
      bytes = await readFile(join(folder, name));
    if (
      !file ||
      file.size !== bytes.length ||
      file.sha256 !== createHash('sha256').update(bytes).digest('hex')
    )
      throw new Error(`Linux clipboard source integrity failed: ${name}`);
    build.update(name).update(bytes);
  }
  if (build.digest('hex') !== native.build) throw new Error('Linux clipboard source build digest failed');
}
{
  const folder = join(root, '.sakura-server/assets/wayland-clipboard');
  const native = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  const sources = JSON.parse(await readFile(join(folder, 'sources.json'), 'utf8'));
  const names = ['controller.py', 'proxy.py', 'sources.json', ...sources.files.map((file) => file.name)];
  const build = createHash('sha256');
  if (
    native.version !== 1 ||
    sources.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(native.build) ||
    names.length !== 20 ||
    new Set(names).size !== 20 ||
    !Array.isArray(native.files) ||
    native.files.length !== 20
  )
    throw new Error('Wayland clipboard source metadata is invalid');
  for (const name of names) {
    if (!/^[a-z0-9-]+\.(py|json|xml)$/.test(name)) throw new Error('Wayland asset name is invalid');
    const file = native.files.find((file) => file.name === name),
      bytes = await readFile(join(folder, name));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (!file || file.size !== bytes.length || file.sha256 !== sha256)
      throw new Error(`Wayland clipboard source integrity failed: ${name}`);
    const original = sources.files.find((file) => file.name === name);
    if (original && (original.size !== bytes.length || original.sha256 !== sha256))
      throw new Error(`Pinned Wayland protocol integrity failed: ${name}`);
    build.update(name).update(bytes);
  }
  if (build.digest('hex') !== native.build) throw new Error('Wayland clipboard source build digest failed');
}
{
  const folder = join(root, '.sakura-server/assets/project-identity');
  const native = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  const names = ['protocol.h', 'launcher.c', 'controller.py'],
    build = createHash('sha256');
  if (
    native.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(native.build) ||
    !Array.isArray(native.files) ||
    native.files.length !== names.length ||
    new Set(native.files.map((file) => file.name)).size !== names.length
  )
    throw new Error('Project identity source metadata is invalid');
  for (const name of names) {
    const file = native.files.find((file) => file.name === name),
      bytes = await readFile(join(folder, name));
    if (
      !file ||
      file.size !== bytes.length ||
      file.sha256 !== createHash('sha256').update(bytes).digest('hex')
    )
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
    if (
      manifest.version !== 1 ||
      manifest.file !== 'broker.py' ||
      !Number.isSafeInteger(manifest.size) ||
      manifest.size < 1 ||
      manifest.size > 262144 ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
      Object.keys(manifest).sort().join(',') !== 'file,sha256,size,version'
    )
      throw new Error(`${name} source metadata is invalid`);
    const bytes = await readFile(join(folder, manifest.file));
    if (
      bytes.length !== manifest.size ||
      createHash('sha256').update(bytes).digest('hex') !== manifest.sha256
    )
      throw new Error(`${name} source integrity failed`);
  }
}
const extensionRoot = join(root, 'browser-extension');
{
  const folder = join(root, '.sakura-server/assets/single-app');
  const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  const names = ['controller.py', 'directory-view.py', 'sources.json'],
    build = createHash('sha256');
  if (
    manifest.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(manifest.build) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== names.length ||
    !manifest.files.every((file, index) => file.name === names[index])
  )
    throw new Error('Single-app source metadata is invalid');
  for (const name of names) {
    const expected = manifest.files.find((file) => file.name === name),
      bytes = await readFile(join(folder, name));
    if (
      !expected ||
      expected.size !== bytes.length ||
      expected.sha256 !== createHash('sha256').update(bytes).digest('hex')
    )
      throw new Error(`Single-app source integrity failed: ${name}`);
    build.update(name).update(bytes);
  }
  if (build.digest('hex') !== manifest.build) throw new Error('Single-app source build digest failed');
}
if (process.platform === 'win32') {
  const folder = join(root, '.sakura-server/assets/gpg-agent-host');
  const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  const expectedKeys = [
    'version',
    'platform',
    'architecture',
    'protocol',
    'file',
    'size',
    'sha256',
    'sourceSha256',
    'compilerSha256',
  ];
  if (
    Object.keys(manifest).sort().join(',') !== expectedKeys.sort().join(',') ||
    manifest.version !== 1 ||
    manifest.protocol !== 1 ||
    manifest.platform !== 'win32' ||
    manifest.architecture !== 'x64' ||
    manifest.file !== 'relay.exe' ||
    !Number.isSafeInteger(manifest.size) ||
    manifest.size < 1 ||
    manifest.size > 16777216 ||
    !['sha256', 'sourceSha256', 'compilerSha256'].every((key) => /^[a-f0-9]{64}$/.test(manifest[key]))
  )
    throw new Error('GPG host helper metadata is invalid');
  const bytes = await readFile(join(folder, manifest.file));
  const source = await readFile(join(root, '.sakura-server/assets/gpg-agent-host-source.cpp'));
  if (
    bytes.length !== manifest.size ||
    createHash('sha256').update(bytes).digest('hex') !== manifest.sha256 ||
    createHash('sha256').update(source).digest('hex') !== manifest.sourceSha256
  )
    throw new Error('GPG host helper byte integrity failed');
  const pe = bytes.length >= 128 && bytes.toString('ascii', 0, 2) === 'MZ' ? bytes.readUInt32LE(0x3c) : 0;
  if (
    pe < 64 ||
    pe + 26 > bytes.length ||
    bytes.readUInt32LE(pe) !== 0x4550 ||
    bytes.readUInt16LE(pe + 4) !== 0x8664 ||
    bytes.readUInt16LE(pe + 24) !== 0x20b
  )
    throw new Error('GPG host helper PE architecture is invalid');
}
const extension = JSON.parse(await readFile(join(extensionRoot, 'manifest.json'), 'utf8'));
if (
  extension.manifest_version !== 3 ||
  extension.action?.default_popup !== 'popup.html' ||
  extension.permissions?.join(',') !== 'storage' ||
  extension.host_permissions?.join(',') !== 'http://127.0.0.1/*'
)
  throw new Error('Browser extension manifest permissions changed unexpectedly');
for (const file of ['popup.html', 'popup.css', 'popup.js', 'background.js'])
  await stat(join(extensionRoot, file));
for (const file of ['popup.js', 'background.js']) {
  const checked = spawnSync(process.execPath, ['--check', join(extensionRoot, file)], { encoding: 'utf8' });
  if (checked.status !== 0) throw new Error(`Invalid browser extension JavaScript: ${file}`);
}
for (const file of [
  'scripts/sakura-tray.ps1',
  'scripts/start-tray.mjs',
  'scripts/launch.mjs',
  'scripts/launch-witness.mjs',
  'scripts/wsl-runtime.mjs',
  'scripts/self-update.mjs',
  'scripts/release-manifest.mjs',
  'scripts/cli.mjs',
  'scripts/guest-cli.mjs',
  'scripts/network-client.mjs',
])
  await stat(join(root, file));
for (const file of [
  'start-tray.mjs',
  'launch.mjs',
  'launch-witness.mjs',
  'wsl-runtime.mjs',
  'self-update.mjs',
  'release-manifest.mjs',
  'cli.mjs',
  'guest-cli.mjs',
  'network-client.mjs',
]) {
  const checked = spawnSync(process.execPath, ['--check', join(root, 'scripts', file)], { encoding: 'utf8' });
  if (checked.status !== 0) throw new Error(`Invalid release script: ${file}`);
}
const jsFiles = [];
/** 递归收集发行目录的 JavaScript 文件路径，后续统一核对打包导入与依赖。
 * Recursively collect distribution JavaScript paths for packaged import/dependency checks. */
async function collect(folder) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, item.name);
    if (item.isDirectory()) await collect(path);
    else if (/\.[cm]?js$/.test(item.name)) jsFiles.push(path);
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
// Vite records all static imports. Count the transitive graph once per page; lazy chunks are excluded.
const frontendManifest = JSON.parse(await readFile(join(root, 'dist', '.vite', 'manifest.json'), 'utf8'));
/** 从 Vite manifest 找到页面入口并递归静态依赖，核对固定 assets 路径/文件并统计首屏资源预算。
 * Resolve a page entry from the Vite manifest, traverse static dependencies and validate fixed asset paths/files for initial-load budgets. */
async function initialJavaScript(entryFile, page) {
  const key = Object.keys(frontendManifest).find(key => frontendManifest[key].file === 'assets/' + entryFile);
  if (!key) throw new Error(`Frontend entry is missing from Vite manifest: ${entryFile}`);
  const visited = new Set(), files = new Set(), assets = new Set();
  /** 有 visited 集合地遍历 Vite chunk，核对 JS/CSS/资源路径并收集依赖，缺失或非法 manifest 条目抛错。
   * Traverse Vite chunks with cycle tracking, validating JS/CSS/asset paths and collecting dependencies; absent/invalid entries throw. */
  const walk = key => {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = frontendManifest[key];
    if (!chunk || typeof chunk.file !== 'string' || !/^assets\/[^/]+\.js$/.test(chunk.file))
      throw new Error(`Invalid static chunk: ${key}`);
    files.add(chunk.file);
    for (const asset of [...(chunk.css || []), ...(chunk.assets || [])]) {
      if (!/^assets\/[a-zA-Z0-9_.-]+$/.test(asset)) throw new Error(`Invalid static asset: ${asset}`);
      assets.add(asset);
    }
    for (const dependency of chunk.imports || []) walk(dependency);
  };
  walk(key);
  for (const tag of page.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    if (tag[0].startsWith('<link') && !/rel="modulepreload"/.test(tag[0])) continue;
    const url = /(?:src|href)="([^"]+)"/.exec(tag[0])?.[1];
    if (!url) continue;
    if (!/^\/[a-zA-Z0-9_./-]+\.js$/.test(url) || url.includes('..'))
      throw new Error(`Unbudgeted initial JavaScript URL: ${url}`);
    const file = url.slice(1);
    const dependency = Object.keys(frontendManifest).find(key => frontendManifest[key].file === file);
    if (dependency) walk(dependency); else files.add(file);
  }
  for (const tag of page.matchAll(/<link\b[^>]*>/g)) {
    if (!/rel="(?:preload|stylesheet|icon)"/.test(tag[0])) continue;
    const url = /href="([^"]+)"/.exec(tag[0])?.[1];
    if (!url || !/^\/[a-zA-Z0-9_./-]+$/.test(url) || url.includes('..'))
      throw new Error(`Unbudgeted initial asset URL: ${url}`);
    if (!files.has(url.slice(1))) assets.add(url.slice(1));
  }
  const sizes = await Promise.all([...files].map(async file => (await stat(join(root, 'dist', file))).size));
  const assetSizes = await Promise.all([...assets].filter(file => !files.has(file)).map(async file => (await stat(join(root, 'dist', file))).size));
  const bytes = sizes.reduce((sum, size) => sum + size, 0);
  return { bytes, chunks: files.size, assetBytes: bytes + Buffer.byteLength(page) + assetSizes.reduce((sum, size) => sum + size, 0) };
}
const initial = await initialJavaScript(entry, html), singleAppInitial = await initialJavaScript(singleAppEntry, singleAppHtml);
// 2.1.0 measured about 878 KB for the main page. Allow a small explicit margin, not an entry-only escape.
const initialBudget = 950_000;
// The unchanged fonts, CSS and painted background add about 680 KB to the JS graph.
// The first complete measurement is 1.57 MB; cap growth at roughly five percent.
const initialAssetBudget = 1_650_000;
for (const [name, measurement] of [['main', initial], ['single-app', singleAppInitial]]) {
  if (measurement.bytes > initialBudget)
    throw new Error(`${name} initial static JavaScript exceeds ${initialBudget} bytes: ${measurement.bytes} (${measurement.chunks} chunks)`);
  if (measurement.assetBytes > initialAssetBudget)
    throw new Error(`${name} initial static assets exceed ${initialAssetBudget} bytes: ${measurement.assetBytes}`);
}
console.log(`Distribution checked: ${jsFiles.length} server modules, ${bytes} byte frontend entry; ` +
  `initial JS main=${initial.bytes} (${initial.chunks} chunks), single-app=${singleAppInitial.bytes} (${singleAppInitial.chunks} chunks), budget=${initialBudget}; ` +
  `initial static assets main=${initial.assetBytes}, single-app=${singleAppInitial.assetBytes}, budget=${initialAssetBudget}.`);
