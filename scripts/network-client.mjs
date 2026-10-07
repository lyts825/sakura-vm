/** CLI 和构建脚本的受管理网络入口；通过服务核心提供 networkFor 与 networkRuntime。 */
import { existsSync } from 'node:fs';

const source = new URL('../server/network-entry.ts', import.meta.url);
// 同一网络契约覆盖源码运行与安装布局；发行入口不能依赖 TypeScript 源码或开发依赖。
// A source checkout uses its current code; an installed release needs no TS/dev dependency.
const core = existsSync(source)
  ? await (await import('tsx/esm/api')).tsImport(source.href, import.meta.url)
  : await import('../.sakura-server/network-entry.js');
export const networkFor = core.networkFor;
export const networkRuntime = core.networkRuntime;
