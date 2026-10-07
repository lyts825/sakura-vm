#!/usr/bin/env node
/** 解析活动安装版本并校验见证运行包，启动已编译见证入口并转发信号和退出码。
 * Resolve the active installation version, verify witness package assets and run its compiled entry while forwarding signals/exit status. */
import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointer, versionPath } from './self-update.mjs';
import { verifyReleaseManifest } from './release-manifest.mjs';

const installation = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** 从活动版本指针核对见证发行资源与固定编译入口，返回可信启动路径。
 * Resolve the active pointer and validate witness release assets/fixed compiled entry before returning its path. */
export async function witnessEntry(root = installation) {
  const current = await pointer(root), selected = versionPath(root, current.active);
  const manifestFile = join(selected, 'sakura-release.json');
  const packaged = await lstat(manifestFile).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (current.active !== '.' || packaged) {
    const manifest = await verifyReleaseManifest(selected);
    if (manifest.schemaVersion !== 2)
      throw new Error('此旧版运行包未校验见证程序；请安装包含见证程序的新运行包');
  }
  const entry = join(selected, '.sakura-witness', 'ha-witness.js');
  const info = await lstat(entry);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('见证程序入口不是普通文件');
  return entry;
}

/** 启动编译见证进程，转发终止信号并等待退出，失败返回非零状态。
 * Start the compiled witness, forward termination and await exit, returning a failure status on errors. */
async function main() {
  const entry = await witnessEntry();
  const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
    cwd: process.cwd(), stdio: 'inherit', windowsHide: true,
  });
  /** 仅向仍存活的本轮见证 child 转发指定信号。
   * Forward the specified signal only to this still-live witness child. */
  const forward = (signal) => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  /** 转发 SIGTERM，让本轮见证停止后按实际退出状态结束。
   * Forward SIGTERM so the witness stops with its actual exit status. */
  /** 转发 SIGINT，让本轮见证协调器执行其取消清理。
   * Forward SIGINT so the owned witness can perform cancellation cleanup. */
  const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    process.exitCode = await new Promise((done, fail) => {
      child.once('error', fail); child.once('exit', (code) => done(code ?? 1));
    });
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => { console.error(error.message); process.exitCode = 1; });
