/**
 * 模块职责：选择开发或发布环境的计算任务入口；发布运行不依赖 TypeScript 开发加载器。
 * Module purpose: Selects development or packaged compute entry points; packaged workers do not require TypeScript development loaders.
 */
import { existsSync } from 'node:fs';

const source = new URL('./compute-task.ts', import.meta.url);
if (existsSync(source)) {
  // Source checkout only; release workers import the bundled entry below and
  // never depend on TypeScript loaders or development dependencies.
  const { tsImport } = await import('tsx/esm/api');
  await tsImport(source.href, import.meta.url);
} else {
  await import('../compute-task.js');
}
