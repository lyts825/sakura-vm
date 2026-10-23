#!/usr/bin/env node
/** 主服务启动器，先检查端口并启动活动版本；健康检查失败时切回已有 previous 指针并重新启动。
 * Launch the active service after checking port ownership; failed candidate health restores the recorded previous pointer and relaunches it. */
import { networkFor } from './network-client.mjs';
const { createServer } = networkFor('tool:launch');
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointer, setPointer, versionPath, waitForHealth } from './self-update.mjs';
import { verifyReleaseManifest } from './release-manifest.mjs';

const installation = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.SAKURA_PORT || 7337);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口无效');

/** 先独占绑定再关闭目标端口，拒绝把其他本机服务的健康响应当作本次启动成功。
 * Bind/close the target port first so another local service’s health response cannot prove this launch succeeded. */
async function requireFreePort() {
  const probe = createServer();
  await new Promise((done, fail) => probe.listen(port, '127.0.0.1', done).once('error', fail));
  await new Promise((done) => probe.close(done));
}

/** 核实版本清单与编译入口后启动，保持安装数据目录；健康失败仅结束本次 child 并抛错，成功返回进程。
 * Verify release/compiled entry and launch with persistent installation data; failed health kills only this child and throws, otherwise return it. */
async function launch(version) {
  const path = versionPath(installation, version);
  if (version !== '.') await verifyReleaseManifest(path);
  const entry = join(path, '.sakura-server', 'index.js');
  await access(entry);
  const child = spawn(process.execPath, [entry], {
    cwd: path, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, SAKURA_DATA_DIR: process.env.SAKURA_DATA_DIR || join(installation, '.data'),
      SAKURA_PORT: String(port), SAKURA_INSTALLATION_ROOT: installation },
  });
  child.on('error', (error) => { child.launchError = error; });
  try { await waitForHealth(child, port); }
  catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    throw error;
  }
  return child;
}

/** 启动 active，失败时持久切回已存在 previous 并重启；转发终止信号并按最终 child 的退出码结束。
 * Launch active, persist/relaunch recorded previous on failure, forward termination signals and exit with the final child’s status. */
async function main() {
  // 先确认目标端口空闲，避免把其他既有服务的健康响应误判成本轮启动成功。
  await requireFreePort();
  const current = await pointer(installation);
  let child;
  try { child = await launch(current.active); }
  catch (error) {
    if (!current.previous) throw error;
    console.error(`新版本启动失败，自动回滚：${error.message}`);
    await setPointer(installation, current.previous, null);
    child = await launch(current.previous);
  }
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); });
  process.exitCode = await new Promise((done) => child.once('exit', (code) => done(code ?? 1)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => { console.error(error); process.exitCode = 1; });
