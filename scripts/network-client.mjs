import { existsSync } from 'node:fs';

const source = new URL('../server/network-entry.ts', import.meta.url);
// A source checkout uses its current code; an installed release needs no TS/dev dependency.
const core = existsSync(source)
  ? await (await import('tsx/esm/api')).tsImport(source.href, import.meta.url)
  : await import('../.sakura-server/network-entry.js');
export const networkFor = core.networkFor;
export const networkRuntime = core.networkRuntime;
