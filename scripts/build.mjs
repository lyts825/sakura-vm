/** 顺序执行源码检查、原生构建、前后端入口与资产准备；每个编译器独占进程并在失败时停止。
 * Run source checks, native builds, application entries and asset preparation in order; isolate compilers and stop on failure. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BUILD_TARGETS } from './build-targets.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = fileURLToPath(new URL('bin/vite.js', import.meta.resolve('vite/package.json')));
const tsc = fileURLToPath(new URL('bin/tsc', import.meta.resolve('typescript/package.json')));

/** 用参数数组运行当前 Node，保留原退出状态；不经过 shell 拼接路径或参数。
 * Run the current Node with an argument array and propagate failures without shell interpolation. */
function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`Build failed: ${script} (${result.signal ?? result.status})`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

try {
  run('scripts/patch-posixloom-process.mjs');
  run(tsc, ['--noEmit']);
  run('scripts/build-native-clipboard.mjs');
  run('scripts/build-gpg-agent-host.mjs');
  run(vite, ['build']);
  for (const target of BUILD_TARGETS.filter((target) => target.group !== 'seventh')) {
    run(vite, [
      'build',
      '--ssr',
      target.entry,
      '--outDir',
      target.outDir,
      ...(target.emptyOutDir ? [] : ['--emptyOutDir', 'false']),
    ]);
  }
  run('scripts/prepare-server-assets.mjs');
  run('scripts/build-seventh.mjs');
} catch (error) {
  console.error(error.message);
  process.exitCode = error.exitCode ?? 1;
}
