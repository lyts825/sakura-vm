#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { inside, releaseEntries, verifyReleaseManifest } from './release-manifest.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function run(command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code}`)));
  });
}

export async function portAvailable() {
  const server = createServer();
  await new Promise((done, fail) => server.listen(0, '127.0.0.1', done).once('error', fail));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

export async function waitForHealth(child, port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let readySince = 0;
  while (Date.now() < deadline) {
    if (child.launchError) throw child.launchError;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`候选服务提前退出（${child.exitCode ?? child.signalCode}）`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/access/status`,
        { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const state = await response.json();
        if (typeof state.enabled === 'boolean' && typeof state.session?.locked === 'boolean') {
          if (!readySince) readySince = Date.now();
          if (Date.now() - readySince >= 2000) return state;
        } else readySince = 0;
      } else readySince = 0;
    } catch { readySince = 0; }
    await delay(200);
  }
  throw new Error('候选服务未通过 60 秒启动健康检查');
}

export async function canary(candidate, installation = root) {
  const temp = await mkdtemp(join(installation, '.sakura-update', 'canary-'));
  if (!inside(join(installation, '.sakura-update'), temp)) throw new Error('临时目录越界');
  const port = await portAvailable();
  const child = spawn(process.execPath, [join(candidate, '.sakura-server', 'index.js')], {
    cwd: candidate, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, SAKURA_DATA_DIR: join(temp, 'data'), SAKURA_PORT: String(port) },
  });
  child.on('error', (error) => { child.launchError = error; });
  try {
    await waitForHealth(child, port);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([new Promise((done) => child.once('exit', done)), delay(5000)]);
    }
    await rm(temp, { recursive: true, force: true });
  }
}

export function versionPath(installation, value) {
  if (value === '.') return installation;
  if (typeof value !== 'string' || !/^versions\/[a-f0-9]{32}$/.test(value))
    throw new Error('升级指针路径无效');
  const path = join(installation, ...value.split('/'));
  if (!inside(join(installation, 'versions'), path)) throw new Error('升级路径越界');
  return path;
}

export async function pointer(installation = root) {
  const file = join(installation, '.sakura-update', 'current.json');
  let value;
  try { value = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return { active: '.', previous: null };
    throw error;
  }
  if (value.schemaVersion !== 1 || typeof value.active !== 'string' ||
      !(value.previous === null || typeof value.previous === 'string'))
    throw new Error('升级指针记录无效');
  versionPath(installation, value.active);
  if (value.previous !== null) versionPath(installation, value.previous);
  return value;
}

export async function setPointer(installation, active, previous) {
  versionPath(installation, active);
  if (previous !== null) versionPath(installation, previous);
  const folder = join(installation, '.sakura-update');
  await mkdir(folder, { recursive: true });
  const temp = join(folder, `current-${randomUUID()}.tmp`);
  if (!inside(folder, temp)) throw new Error('升级指针越界');
  try {
    await writeFile(temp, JSON.stringify({ schemaVersion: 1, active, previous,
      switchedAt: new Date().toISOString() }) + '\n', { flag: 'wx' });
    await rename(temp, join(folder, 'current.json'));
  } finally { await rm(temp, { force: true }); }
}

async function prepareRuntime(candidate, installation) {
  const expected = await readFile(join(installation, 'scripts', 'versions.mjs'), 'utf8');
  const actual = await readFile(join(candidate, 'scripts', 'versions.mjs'), 'utf8');
  if (expected !== actual)
    throw new Error('此更新改变了 QEMU/PosixLoom 版本；请先使用完整安装流程更新运行时');
  for (const name of ['.vendor', '.tools']) {
    const source = join(installation, name);
    const info = await lstat(source);
    if (!info.isDirectory()) throw new Error(`本机运行时目录无效：${name}`);
    await symlink(source, join(candidate, name), process.platform === 'win32' ? 'junction' : 'dir');
  }
}

export async function stageUpdate(source, installation = root, options = {}) {
  const selected = await realpath(source);
  const manifest = await verifyReleaseManifest(selected);
  await mkdir(join(installation, 'versions'), { recursive: true });
  await mkdir(join(installation, '.sakura-update'), { recursive: true });
  const id = randomUUID().replaceAll('-', '');
  const candidate = versionPath(installation, `versions/${id}`);
  await mkdir(candidate);
  try {
    for (const entry of releaseEntries)
      await cp(join(selected, entry), join(candidate, entry), { recursive: true, errorOnExist: true, force: false });
    await cp(join(selected, 'sakura-release.json'), join(candidate, 'sakura-release.json'));
    await verifyReleaseManifest(candidate);
    await prepareRuntime(candidate, installation);
    if (!options.skipInstall) {
      if (process.platform === 'win32')
        await run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c',
          'npm ci --omit=dev --ignore-scripts'], candidate);
      else await run('npm', ['ci', '--omit=dev', '--ignore-scripts'], candidate);
    }
    if (!options.skipCanary) await canary(candidate, installation);
    await writeFile(join(candidate, '.sakura-verified.json'),
      JSON.stringify({ fingerprint: manifest.fingerprint, checkedAt: new Date().toISOString() }) + '\n');
    return { version: manifest.version, fingerprint: manifest.fingerprint,
      path: relative(installation, candidate).replaceAll('\\', '/') };
  } catch (error) {
    // Only this freshly created, checked path is removed. Existing versions and user data are untouched.
    if (!inside(join(installation, 'versions'), candidate)) throw error;
    await rm(candidate, { recursive: true, force: true });
    throw error;
  }
}

export async function activateUpdate(version, installation = root) {
  const candidate = versionPath(installation, version);
  if (version === '.') throw new Error('请选择已预检的新版本');
  const manifest = await verifyReleaseManifest(candidate);
  const info = await lstat(candidate);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('候选版本目录不是普通目录');
  const verified = JSON.parse(await readFile(join(candidate, '.sakura-verified.json'), 'utf8'));
  if (verified.fingerprint !== manifest.fingerprint) throw new Error('候选版本的验证记录不匹配');
  const before = await pointer(installation);
  if (before.active === version) return before;
  await setPointer(installation, version, before.active);
  return await pointer(installation);
}

export async function rollbackUpdate(installation = root) {
  const before = await pointer(installation);
  if (!before.previous) throw new Error('没有可回滚的上一个版本');
  await setPointer(installation, before.previous, null);
  return await pointer(installation);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, argument] = process.argv.slice(2);
  try {
    if (action === 'status') console.log(JSON.stringify(await pointer(), null, 2));
    else if (action === 'check') {
      const manifest = await verifyReleaseManifest(await realpath(argument));
      console.log(JSON.stringify({ version: manifest.version, fingerprint: manifest.fingerprint,
        files: manifest.files.length }, null, 2));
    }
    else if (action === 'stage') console.log(JSON.stringify(await stageUpdate(argument), null, 2));
    else if (action === 'activate') console.log(JSON.stringify(await activateUpdate(argument), null, 2));
    else if (action === 'rollback') console.log(JSON.stringify(await rollbackUpdate(), null, 2));
    else throw new Error('用法：node scripts/self-update.mjs <status|check 包目录|stage 包目录|activate versions/编号|rollback>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
