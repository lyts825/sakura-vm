export function resumableDownload(
  api: (path: string) => Promise<any>,
  vmId: string,
  path: string,
  destination: string,
): Promise<{ output: string; bytes: number; sha256: string; downloadedChunks: number; reusedChunks: number }>;
