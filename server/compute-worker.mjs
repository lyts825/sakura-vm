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
