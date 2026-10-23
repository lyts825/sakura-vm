#!/usr/bin/env node
/** 自更新预检、暂存、激活与回滚，校验发行摘要并用隔离数据目录进行候选健康检查，再替换活动版本指针。
 * Preflight, stage, activate and roll back verified releases; run isolated candidate health before replacing the active pointer. */
import { networkFor } from './network-client.mjs';
const updateNetwork = networkFor('tool:self-update');
const { fetch, createServer } = updateNetwork;
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { inside, releaseEntriesFor, verifyReleaseManifest } from './release-manifest.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** 中文：逐层拒绝安装根及受管路径中的链接，缺失路径只允许后续受控创建。English: Reject links at every installation/managed-path component; missing tails may only be created by the caller. */
export async function validateInstallationPath(installation, target = installation, allowMissing = false) {
  const base = resolve(installation), path = resolve(target);
  if (path !== base && !inside(base, path)) throw new Error('更新路径越界');
  const rootInfo = await lstat(base);
  const canonical = await realpath(base);
  const normalize = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || normalize(canonical) !== normalize(base)) throw new Error('安装根不能包含链接');
  const segments = relative(base, path).split(/[\\/]/).filter(Boolean);
  let cursor = base;
  for (let index = 0; index < segments.length; index++) {
    cursor = join(cursor, segments[index]);
    let info;
    try { info = await lstat(cursor); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) || (index < segments.length - 1 && !info.isDirectory()))
      throw new Error('更新路径不能包含链接或特殊文件');
    if (normalize(await realpath(cursor)) !== normalize(cursor)) throw new Error('更新路径不能包含链接');
  }
}

/** 在受管网络代理环境中启动外部工具并等待成功，finally 关闭本轮代理租约，启动或非零退出抛错。
 * Run external tools with the managed proxy environment, await success and close this proxy lease in finally; spawn/nonzero failures throw. */
async function run(command, args, cwd) {
  const proxy = await updateNetwork.proxyEnvironment();
  try {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true,
      env: { ...process.env, ...proxy.env } });
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code}`)));
    });
  } finally { await proxy.close(); }
}

/** 短暂绑定 IPv4 回环端口取得可用性结论并关闭 listener，不能以既有服务响应证明端口属于候选。
 * Probe port availability by briefly binding IPv4 loopback and closing the listener, without accepting existing service replies as candidate ownership. */
export async function portAvailable() {
  const server = createServer();
  await new Promise((done, fail) => server.listen(0, '127.0.0.1', done).once('error', fail));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

/** 在总截止内检查子进程存活及连续健康窗口；启动错误、退出或超时失败，避免瞬时健康即激活。
 * Require child liveness and a continuous health window within the deadline; spawn errors, exit or timeout fail instead of accepting momentary health. */
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

/** 用独立临时数据目录和自有端口启动候选服务，健康后记录验证指纹，finally 停止候选并清理本轮数据。
 * Start the candidate with isolated temporary data/owned port, record its verified fingerprint after health and stop/clean owned data in finally. */
export async function canary(candidate, installation = root) {
  await validateInstallationPath(installation, join(installation, '.sakura-update'));
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
    await validateInstallationPath(installation, temp);
    await rm(temp, { recursive: true, force: true });
  }
}

/** 仅允许当前根或 versions 下固定 32 位十六进制目录，拒绝点段、绝对路径与逃逸。
 * Allow only the installation root or fixed 32-hex directories under versions, rejecting dot segments/absolute paths/escape. */
export function versionPath(installation, value) {
  if (value === '.') return installation;
  if (typeof value !== 'string' || !/^versions\/[a-f0-9]{32}$/.test(value))
    throw new Error('升级指针路径无效');
  const path = join(installation, ...value.split('/'));
  if (!inside(join(installation, 'versions'), path)) throw new Error('升级路径越界');
  return path;
}

/** 读取活动/previous 指针并验证每个版本路径，缺失时使用当前根，畸形记录拒绝。
 * Read/validate active and previous version pointers, defaulting to the installation root only on absence and rejecting malformed records. */
export async function pointer(installation = root) {
  const file = join(installation, '.sakura-update', 'current.json');
  await validateInstallationPath(installation, file, true);
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

/** 以独占临时文件写入新 active/previous，再在同目录 rename 替换，失败清理本轮临时文件。
 * Write active/previous through an exclusive temporary and same-directory rename, cleaning only this temporary on failure. */
export async function setPointer(installation, active, previous, check = () => {}) {
  // 指针只接受已限定的版本路径；同目录临时记录经 rename 发布，读取方不会看到半份 JSON。
  versionPath(installation, active);
  if (previous !== null) versionPath(installation, previous);
  const folder = join(installation, '.sakura-update');
  await validateInstallationPath(installation, folder, true);
  await mkdir(folder, { recursive: true });
  await validateInstallationPath(installation, join(folder, 'current.json'), true);
  const temp = join(folder, `current-${randomUUID()}.tmp`);
  if (!inside(folder, temp)) throw new Error('升级指针越界');
  try {
    await writeFile(temp, JSON.stringify({ schemaVersion: 1, active, previous,
      switchedAt: new Date().toISOString() }) + '\n', { flag: 'wx' });
    await check(); await validateInstallationPath(installation, join(folder, 'current.json'), true);
    await rename(temp, join(folder, 'current.json'));
  } finally { await validateInstallationPath(installation, temp, true); await rm(temp, { force: true }); }
}

/** 要求版本准备脚本字节一致，复用已核实工具目录并以 npm ci 禁用生命周期脚本安装生产依赖。
 * Require identical runtime preparation scripts, reuse validated tool directories and install production dependencies with npm ci lifecycle scripts disabled. */
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

/** 完整核实发行清单后复制到新候选目录，再核实副本、准备运行时与隔离健康检查；失败清理本次暂存。
 * Verify the full release manifest, copy to a fresh candidate, reverify/prepare runtime/run isolated health and clean this stage on failure. */
export async function stageUpdate(source, installation = root, options = {}) {
  // 候选先复制到新版本目录并再次验摘要；使用独立数据目录预检，成功后才允许修改活动指针。
  const selected = await realpath(source);
  const manifest = await verifyReleaseManifest(selected);
  await validateInstallationPath(installation, join(installation, 'versions'), true);
  await validateInstallationPath(installation, join(installation, '.sakura-update'), true);
  await mkdir(join(installation, 'versions'), { recursive: true });
  await mkdir(join(installation, '.sakura-update'), { recursive: true });
  const id = randomUUID().replaceAll('-', '');
  const candidate = versionPath(installation, `versions/${id}`);
  await mkdir(candidate);
  await validateInstallationPath(installation, candidate);
  try {
    for (const entry of releaseEntriesFor(manifest.schemaVersion))
      await cp(join(selected, entry), join(candidate, entry), { recursive: true, errorOnExist: true, force: false });
    await cp(join(selected, 'sakura-release.json'), join(candidate, 'sakura-release.json'));
    await verifyReleaseManifest(candidate);
    // 中文：可信入口在任何依赖安装或候选执行之前复核副本签名。English: Trusted callers revalidate the copied signature before dependency installation or candidate execution.
    if (options.verifyCandidate) await options.verifyCandidate(candidate);
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
    await validateInstallationPath(installation, candidate);
    await rm(candidate, { recursive: true, force: true });
    throw error;
  }
}

/** 重新核对候选目录、发行指纹和健康标记后替换活动指针，previous 保留原活动版本用于启动失败回滚。
 * Revalidate candidate directory/release fingerprint/health marker before pointer replacement, retaining the prior active version for rollback. */
export async function activateUpdate(version, installation = root, check = () => {}) {
  const candidate = versionPath(installation, version);
  await validateInstallationPath(installation, candidate);
  if (version === '.') throw new Error('请选择已预检的新版本');
  const manifest = await verifyReleaseManifest(candidate);
  const info = await lstat(candidate);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('候选版本目录不是普通目录');
  await validateInstallationPath(installation, join(candidate, '.sakura-verified.json'));
  const verified = JSON.parse(await readFile(join(candidate, '.sakura-verified.json'), 'utf8'));
  if (verified.fingerprint !== manifest.fingerprint) throw new Error('候选版本的验证记录不匹配');
  const before = await pointer(installation);
  if (before.active === version) return before;
  await check();
  await setPointer(installation, version, before.active, check);
  return await pointer(installation);
}

/** 要求已记录 previous，切回该版本并清空 previous，避免重复回滚环路。
 * Require a recorded previous version, switch back and clear previous to prevent repeated rollback loops. */
export async function rollbackUpdate(installation = root, check = () => {}) {
  const before = await pointer(installation);
  if (!before.previous) throw new Error('没有可回滚的上一个版本');
  await validateInstallationPath(installation, versionPath(installation, before.previous));
  await check();
  await setPointer(installation, before.previous, null, check);
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
