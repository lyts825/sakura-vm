/** 发行编译入口的唯一清单，供构建和分发检查共同使用；次入口不得清空共享输出目录。
 * Single manifest of release entry points for builds and distribution checks; secondary entries preserve shared output. */
import { basename } from 'node:path';

export const BUILD_TARGETS = Object.freeze(
  [
    { entry: 'server/index.ts', outDir: '.sakura-server', emptyOutDir: true },
    { entry: 'scripts/ha-witness.ts', outDir: '.sakura-witness', emptyOutDir: true },
    ...[
      'network-entry',
      'compute-task',
      'supply-offline',
      'locale-offline',
      'incident-offline',
      'browser-offline',
      'database-offline',
      'evaluation-offline',
      'event-offline',
      'flow-offline',
      'media-offline',
      'learning-offline',
    ].map((name) => ({ entry: `server/${name}.ts`, outDir: '.sakura-server', emptyOutDir: false })),
    ...['seventh-worker-task', 'seventh-offline'].map((name) => ({
      entry: `server/${name}.ts`,
      outDir: '.sakura-server',
      emptyOutDir: false,
      group: 'seventh',
    })),
  ].map((target) =>
    Object.freeze({ ...target, output: `${target.outDir}/${basename(target.entry, '.ts')}.js` }),
  ),
);
