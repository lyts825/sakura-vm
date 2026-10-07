/** 可恢复下载函数的 TypeScript 声明，描述调用方 API、实例、路径和本地目标参数。 */
export function resumableDownload(
  api: (path: string) => Promise<any>,
  vmId: string,
  path: string,
  destination: string,
): Promise<{ output: string; bytes: number; sha256: string; downloadedChunks: number; reusedChunks: number }>;
