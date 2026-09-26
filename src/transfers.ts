import { resumableUpload } from './resumable-upload';
export type UploadProgress = {
  name: string;
  index: number;
  count: number;
  loaded: number;
  total: number;
  phase?: string;
};
export const transferBytes = (value: number) => {
  const unit = value >= 1024 ** 3 ? 3 : value >= 1024 ** 2 ? 2 : value >= 1024 ? 1 : 0;
  return `${unit ? (value / 1024 ** unit).toFixed(1) : value} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`;
};
type Options = {
  files: File[];
  url: (name: string) => string;
  token: string;
  signal: AbortSignal;
  progress: (value: UploadProgress) => void;
};
export async function uploadFiles({ files, url, token, signal, progress }: Options) {
  for (const file of files)
    if (file.size > 2 * 1024 ** 3) throw new Error(`${file.name} 超过单文件 2 GiB 上限`);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  let completed = 0;
  for (const [index, file] of files.entries()) {
    signal.throwIfAborted();
    const report = (loaded: number) =>
      progress({ name: file.name, index: index + 1, count: files.length, loaded: completed + loaded, total });
    report(0);
    if (file.size >= 8 * 1024 ** 2) {
      await resumableUpload(file, url(file.name), token, signal, (loaded, phase) =>
        progress({
          name: file.name,
          index: index + 1,
          count: files.length,
          loaded: completed + loaded,
          total,
          phase,
        }),
      );
      completed += file.size;
      continue;
    }
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', cancel);
        xhr.onload = xhr.onerror = xhr.onabort = null;
        xhr.upload.onprogress = null;
        if (error) reject(error);
        else resolve();
      };
      const cancel = () => {
        xhr.abort();
        finish(new DOMException('上传已取消', 'AbortError'));
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        xhr.open('PUT', url(file.name));
        xhr.setRequestHeader('X-Sakura-Token', token);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.upload.onprogress = (event) => report(Math.min(file.size, event.loaded));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) finish();
          else {
            let message = `上传失败（HTTP ${xhr.status}）`;
            try {
              message = JSON.parse(xhr.responseText).error || message;
            } catch {}
            finish(new Error(`${file.name}：${message}`));
          }
        };
        xhr.onerror = () => finish(new Error(`${file.name}：上传连接中断`));
        xhr.onabort = () => finish(new DOMException('上传已取消', 'AbortError'));
        if (signal.aborted) cancel();
        else xhr.send(file);
      } catch (error) {
        finish(error as Error);
      }
    });
    completed += file.size;
  }
}
