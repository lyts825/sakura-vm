/**
 * 模块职责：以分块校验和上传会话续传浏览器文件，在所有块确认后提交最终文件。
 */
const CHUNK_BYTES = 1024 ** 2;
const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
type Session = {
  id: string;
  chunkBytes: number;
  received: number[];
  completed?: { bytes: number; sha256: string };
};

export async function resumableUpload(
  file: File,
  transferUrl: string,
  token: string,
  signal: AbortSignal,
  progress: (bytes: number, phase: string) => void,
  fileLockToken?: string,
) {
  const destination = new URL(transferUrl, window.location.origin);
  const endpoint = destination.pathname.replace(/\/transfer$/, '/uploads');
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
