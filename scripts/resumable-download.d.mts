/** 可恢复下载函数的 TypeScript 声明，描述调用方 API、实例、路径和本地目标参数。
 * Declare the verified chunk-download API and its caller-supplied transport/output contract. */
/** 声明有界分块下载的调用约定：API/连接上下文、VM 文件路径和输出位置，返回已校验的最终文件信息或拒绝错误。
 * Declare bounded chunk-download inputs: API/connection context, VM path/output destination, yielding verified final-file information or refusal. */
export function resumableDownload(
  api: (path: string) => Promise<any>,
  vmId: string,
  path: string,
  destination: string,
): Promise<{ output: string; bytes: number; sha256: string; downloadedChunks: number; reusedChunks: number }>;
