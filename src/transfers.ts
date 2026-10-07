/**
 * 模块职责（中文）：上传浏览器文件列表并反馈总进度，按文件大小选择普通流式或可续传分块路径。
 * Module responsibility (English): Selecting upload paths by file size and aggregating progress and cancellation.
 * 详细范围（中文）：公开入口包括 UploadProgress, transferBytes, uploadFiles；职责覆盖按文件规模选择上传路径并汇总进度和取消，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include UploadProgress, transferBytes, uploadFiles. The scope covers Selecting upload paths by file size and aggregating progress and cancellation. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { resumableUpload } from './resumable-upload';
export type UploadProgress = {
  name: string;
  index: number;
  count: number;
  loaded: number;
  total: number;
  phase?: string;
};
/**
 * 中文：按二进制阈值选择 B/KiB/MiB/GiB，除字节外保留一位小数用于传输进度。
 * English: Select B/KiB/MiB/GiB by binary thresholds, retaining one fractional digit except bytes for transfer progress.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 */
export const transferBytes = (value: number) => {
  const unit = value >= 1024 ** 3 ? 3 : value >= 1024 ** 2 ? 2 : value >= 1024 ? 1 : 0;
  return `${unit ? (value / 1024 ** unit).toFixed(1) : value} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`;
};
type Options = {
  files: File[];
  url: /** 中文：按当前文件名生成传输 URL，保证每文件有独立目标路径；这是 Options 的调用契约 | English: Build a transfer URL from the filename with a distinct per-file target path; this is the callable contract of Options | 中文：输入：name：目标名称或文件名 | English: Inputs: name: target name/filename | 中文：结果：string；调用者依赖此类型约定 | English: Result: string; callers depend on this type contract */ (name: string) => string;
  token: string;
  fileLockToken?: /** 中文：按目标文件名查询已持有文件锁票据，未持有可返回 undefined；这是 Options 的调用契约 | English: Look up held file-lock tickets by target filename, returning undefined if absent; this is the callable contract of Options | 中文：输入：name：目标名称或文件名 | English: Inputs: name: target name/filename | 中文：结果：string | undefined；调用者依赖此类型约定 | English: Result: string | undefined; callers depend on this type contract */ (name: string) => string | undefined;
  signal: AbortSignal;
  progress: /** 中文：交付当前传输字节数与阶段，供外层汇总显示；这是 Options 的调用契约 | English: Deliver current transfer bytes/phase for outer progress aggregation; this is the callable contract of Options | 中文：输入：value：待校验、转换或保存的输入值 | English: Inputs: value: input value to validate/transform/save | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (value: UploadProgress) => void;
};
/**
 * 中文：先拒绝超过 2 GiB 的文件，再顺序上传；8 MiB 起使用可续传分块，其余 XHR 支持进度和取消，附带文件锁票据，只有确认成功才累计完成字节。
 * English: Reject files over two GiB, then upload sequentially. Use resumable chunks from eight MiB or XHR with progress/cancellation otherwise, attach file-lock tickets and count completed bytes only after success confirmation.
 * 中文：输入：{ files, url, token, fileLockToken, signal, progress } 提供 files（本批次按顺序上传的文件集合）、url（url 状态）、token（当前传输认证凭证）、fileLockToken（fileLockToken 状态）、signal（本次调用的取消寿命）、progress（交付已处理字节和阶段的回调） 上下文字段
 * English: Inputs: { files, url, token, fileLockToken, signal, progress } provides context fields files (files uploaded sequentially in this batch), url (url state), token (current transport credential), fileLockToken (fileLockToken state), signal (cancellation lifetime for this invocation), progress (callback delivering processed bytes/phase)
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 * 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作
 * English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step
 */
export async function uploadFiles({ files, url, token, fileLockToken, signal, progress }: Options) {
  for (const file of files)
    if (file.size > 2 * 1024 ** 3) throw new Error(`${file.name} 超过单文件 2 GiB 上限`);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  let completed = 0;
  for (const [index, file] of files.entries()) {
    signal.throwIfAborted();
    /**
     * 中文：把当前文件已发送字节与前面已完成文件累计值合并，报告一基文件序号和总量。
     * English: Combine this file's sent bytes with prior completed files, reporting a one-based file index and total size.
     * 中文：输入：loaded：签名所示 number 业务值
     * English: Inputs: loaded: the number domain value in the signature
     */
    const report = (loaded: number) =>
      progress({ name: file.name, index: index + 1, count: files.length, loaded: completed + loaded, total });
    report(0);
    if (file.size >= 8 * 1024 ** 2) {
      await resumableUpload(
        file, url(file.name), token, signal,
        (loaded, phase) => progress({
          name: file.name,
          index: index + 1,
          count: files.length,
          loaded: completed + loaded,
          total,
          phase,
        }),
        fileLockToken?.(file.name),
      );
      completed += file.size;
      continue;
    }
    await new Promise<void>(/** 中文：在按文件规模选择上传路径并汇总进度和取消流程中登记浏览器或资源事件监听，向活动传输交付数据；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Selecting upload paths by file size and aggregating progress and cancellation, register browser/resource event listeners, deliver data to an active transport. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：resolve：此处理器的调用值；reject：此处理器的调用值 | English: Inputs: resolve: the invocation value for this handler; reject: the invocation value for this handler | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ (resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;
      /**
       * 中文：通过 settled 保证 XHR Promise 仅结束一次，先移除取消/进度/终结回调，再按是否有错误 resolve/reject。
       * English: Use settled to finish the XHR promise once, detach cancellation/progress/terminal callbacks first and resolve/reject according to error presence.
       * 中文：输入：error：签名所示 Error 业务值
       * English: Inputs: error: the Error domain value in the signature
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', cancel);
        xhr.onload = xhr.onerror = xhr.onabort = null;
        xhr.upload.onprogress = null;
        if (error) reject(error);
        else resolve();
      };
      /**
       * 中文：主动中止 XHR 并通过统一 finish 报 AbortError，防止 abort 事件和主动取消重复完成。
       * English: Abort XHR and report AbortError through finish, preventing abort-event and explicit-cancellation double completion.
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      const cancel = () => {
        xhr.abort();
        finish(new DOMException('上传已取消', 'AbortError'));
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        xhr.open('PUT', url(file.name));
        xhr.setRequestHeader('X-Sakura-Token', token);
        const lease = fileLockToken?.(file.name);
        if (lease) xhr.setRequestHeader('X-Sakura-File-Lock', lease);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        /**
         * 中文：将浏览器进度限制到当前文件字节数，再交给累计进度汇总。
         * English: Clamp browser progress to the current file size before cumulative reporting.
         * 中文：输入：event：触发本处理器的事件及其数据
         * English: Inputs: event: triggering event and its data
         */
        xhr.upload.onprogress = (event) => report(Math.min(file.size, event.loaded));
        /**
         * 中文：仅 2xx 确认上传成功；其他状态尝试读取服务器错误并附文件名，统一拒绝本轮 Promise。
         * English: Confirm success only for 2xx; otherwise try to read the server error, attach the filename and reject this promise through shared completion.
         * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
         * English: Result: deliver through the described state/resource effects without returning business data
         */
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
        /**
         * 中文：把网络断开表示为带当前文件名的失败，交由 finish 移除监听并拒绝。
         * English: Represent network interruption as a filename-specific failure, letting finish remove handlers and reject.
         */
        xhr.onerror = () => finish(new Error(`${file.name}：上传连接中断`));
        /**
         * 中文：把传输中止转换为 AbortError，并通过统一终结路径释放监听。
         * English: Convert transport abortion to AbortError and release handlers through shared finalization.
         */
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
