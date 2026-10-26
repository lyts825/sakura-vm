/** 开发环境载入固定 TypeScript 计算入口；发行环境只载入已编译入口。 */
import { existsSync } from 'node:fs';
const source=new URL('./seventh-worker-task.ts',import.meta.url);
if(existsSync(source)){const {tsImport}=await import('tsx/esm/api');await tsImport(source.href,import.meta.url);}
else {
  const compiled=new URL('./seventh-worker-task.js',import.meta.url);
  await import(existsSync(compiled)?compiled.href:new URL('../seventh-worker-task.js',import.meta.url).href);
}
