#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointer, versionPath } from './self-update.mjs';
import { verifyReleaseManifest } from './release-manifest.mjs';

const installation = resolve(fileURLToPath(new URL('..', import.meta.url)));

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

async function main() {
  const entry = await witnessEntry();
  const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
    cwd: process.cwd(), stdio: 'inherit', windowsHide: true,
  });
  const forward = (signal) => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
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
