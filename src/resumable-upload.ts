/**
 * 模块职责（中文）：以分块校验和上传会话续传浏览器文件，在所有块确认后提交最终文件。
 * Module responsibility (English): Hashing chunks and resuming missing content before confirming the committed file.
 * 详细范围（中文）：公开入口包括 resumableUpload；职责覆盖校验分块并续传缺失内容，在提交后确认最终文件，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include resumableUpload. The scope covers Hashing chunks and resuming missing content before confirming the committed file. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
const CHUNK_BYTES = 1024 ** 2;
/**
 * 中文：将摘要字节按两位小写十六进制拼接，供分块及完整文件摘要提交。
 * English: Join digest bytes as two-digit lowercase hexadecimal for chunk/full-file digest submission.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 */
const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
type Session = {
  id: string;
  chunkBytes: number;
  received: number[];
  completed?: { bytes: number; sha256: string };
};

/**
 * 中文：逐块读取并计算摘要，向服务端恢复上传会话，只发送缺失块；确认提交后再报告完成，取消信号贯穿读取和请求，失败不伪造已保存结果。
 * English: Read/hash chunks, restore a server upload session and send only missing chunks. Report completion only after commit confirmation; carry cancellation through reads/requests and never fabricate a saved result on failure.
 * 中文：输入：file：当前上传或处理的文件；transferUrl：签名所示 string 业务值；token：当前传输认证凭证；signal：本次调用的取消寿命；progress：任务的可选数字进度值；fileLockToken：签名所示 string 业务值
 * English: Inputs: file: file being uploaded/processed; transferUrl: the string domain value in the signature; token: current transport credential; signal: cancellation lifetime for this invocation; progress: optional numeric job progress; fileLockToken: the string domain value in the signature
 * 中文：拒绝原因：上传分块协议不兼容。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 上传分块协议不兼容. These errors reach the direct caller or this function's catch handler
 * 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作
 * English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step
 */
export async function resumableUpload(
  file: File,
  transferUrl: string,
  token: string,
  signal: AbortSignal,
  progress: /** 中文：交付当前传输字节数与阶段，供外层汇总显示；这是 resumableUpload 的调用契约 | English: Deliver current transfer bytes/phase for outer progress aggregation; this is the callable contract of resumableUpload | 中文：输入：bytes：签名所示 number 业务值；phase：签名所示 string 业务值 | English: Inputs: bytes: the number domain value in the signature; phase: the string domain value in the signature | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (bytes: number, phase: string) => void,
  fileLockToken?: string,
) {
  const destination = new URL(transferUrl, window.location.origin);
  const endpoint = destination.pathname.replace(/\/transfer$/, '/uploads');
  /**
   * 中文：在每次上传请求前检查取消，把 JSON 正文或二进制块交给同一认证能力并保留调用者信号。
   * English: Check cancellation before each upload request, forwarding JSON bodies/binary chunks through the same authenticated capability with the caller's signal.
   * 中文：输入：url：签名所示 string 业务值；method：请求 HTTP 方法；body：待按操作契约编码的请求正文
   * English: Inputs: url: the string domain value in the signature; method: request HTTP method; body: request body to encode under the operation contract
   * 中文：结果：Promise<T>，包含上述计算或传输完成值；抛错分支不提供成功结果
   * English: Result: Promise<T> carrying the described computation/transport result; throwing branches do not provide success
   */
  const request = async <T>(url: string, method: string, body?: BodyInit): Promise<T> => {
    const response = await fetch(url, {
      method,
      signal,
      headers: {
        'X-Sakura-Token': token,
        ...(fileLockToken ? { 'X-Sakura-File-Lock': fileLockToken } : {}),
        'Content-Type': method === 'PUT' ? 'application/octet-stream' : 'application/json',
      },
      body,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `上传失败（HTTP ${response.status}）`);
    }
    return response.json();
  };
  // 先计算完整分块清单，使服务端以内容确认已有块；续传跳过的块仍计入用户看到的完成进度。
  const chunks: string[] = [];
  for (let start = 0; start < file.size; start += CHUNK_BYTES) {
    signal.throwIfAborted();
    progress(0, `校验 ${Math.min(100, Math.round((start / file.size) * 100))}%`);
    chunks.push(
      hex(await crypto.subtle.digest('SHA-256', await file.slice(start, start + CHUNK_BYTES).arrayBuffer())),
    );
  }
  const session = await request<Session>(
    endpoint,
    'POST',
    JSON.stringify({
      path: destination.searchParams.get('path'),
      size: file.size,
      chunks,
      overwrite: destination.searchParams.get('overwrite') === '1',
    }),
  );
  if (session.chunkBytes !== CHUNK_BYTES) throw new Error('上传分块协议不兼容');
  if (session.completed) {
    progress(file.size, '已完成');
    return session.completed;
  }
  const received = new Set(session.received);
  let sent = [...received].reduce(
    (total, index) => total + Math.min(CHUNK_BYTES, file.size - index * CHUNK_BYTES),
    0,
  );
  progress(sent, received.size ? '继续上传' : '上传');
  for (let index = 0; index < chunks.length; index++) {
    signal.throwIfAborted();
    if (received.has(index)) continue;
    const chunk = file.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
    await request(`${endpoint}?id=${encodeURIComponent(session.id)}&chunk=${index}`, 'PUT', chunk);
    sent += chunk.size;
    progress(sent, '上传');
  }
  // 块上传完成仅表示暂存完整；最终提交仍需服务端确认，文件锁令牌贯穿分块与提交请求。
  progress(file.size, '正在保存');
  return request<{ bytes: number; sha256: string }>(
    `${endpoint}?id=${encodeURIComponent(session.id)}`,
    'POST',
    '{}',
  );
}
