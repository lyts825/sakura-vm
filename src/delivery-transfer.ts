/** 浏览器分块传输和增量 SHA-256；文件内容不一次读入内存。
 * Bounded browser transfers with incremental SHA-256 avoid loading entire input files. */
import type { Request } from './feature-shared';
import { z } from 'zod';
import { deliveryManifestSchema, type DeliveryFile } from '../shared/contracts/delivery-common';
const constants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);
/** SHA-256 的 32 位循环右移。 Rotate a 32-bit SHA-256 word right. */
const rotate = (x: number, n: number) => (x >>> n) | (x << (32 - n));
export class DeliveryHash {
  private state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private pending = new Uint8Array(64);
  private length = 0;
  private used = 0;
  /** 吸收字节，仅保留不足 64 字节的尾部，返回当前摘要器。
   * Consume bytes, retain only an incomplete block and return this hasher. */
  update(bytes: Uint8Array) {
    this.length += bytes.length;
    for (let offset = 0; offset < bytes.length;) {
      const take = Math.min(64 - this.used, bytes.length - offset);
      this.pending.set(bytes.subarray(offset, offset + take), this.used);
      this.used += take;
      offset += take;
      if (this.used === 64) {
        this.block(this.pending);
        this.used = 0;
      }
    }
    return this;
  }
  /** 压缩一个 64 字节块并推进内部状态。 Compress one 64-byte block into the internal state. */
  private block(bytes: Uint8Array) {
    const words = new Uint32Array(64),
      view = new DataView(bytes.buffer, bytes.byteOffset, 64);
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(i * 4);
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15],
        b = words[i - 2];
      words[i] =
        words[i - 16] +
        (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) +
        words[i - 7] +
        (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (h +
          (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
          ((e & f) ^ (~e & g)) +
          constants[i] +
          words[i]) >>>
        0;
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((word, i) => {
      this.state[i] = (this.state[i] + word) >>> 0;
    });
  }
  /** 一次性添加填充并返回十六进制摘要，此后不再复用该实例。
   * Finalize once with padding and return a hexadecimal digest; do not reuse this instance. */
  digest() {
    const tail = new Uint8Array(this.used < 56 ? 64 : 128);
    tail.set(this.pending.subarray(0, this.used));
    tail[this.used] = 0x80;
    const view = new DataView(tail.buffer);
    view.setUint32(tail.length - 8, Math.floor(this.length / 0x20000000));
    view.setUint32(tail.length - 4, (this.length * 8) >>> 0);
    for (let i = 0; i < tail.length; i += 64) this.block(tail.subarray(i, i + 64));
    return Array.from(this.state, (word) => word.toString(16).padStart(8, '0')).join('');
  }
}
const chunkSize = 512 * 1024;
/** 有界转换 Base64，避免大型参数展开。 Encode Base64 without an unbounded argument spread. */
const encode = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};
/** 先计算摘要，再分块上传并封存；返回校验后的清单，取消保留服务器可恢复上传。
 * Hash first, upload bounded blocks and return the verified sealed manifest; cancellation leaves resumable server state. */
export async function uploadDeliveryFile(
  request: Request,
  url: string,
  file: File,
  signal: AbortSignal,
  progress: (text: string) => void,
) {
  if (file.size > 2 ** 30) throw new Error('单文件最多 1 GiB');
  const hash = new DeliveryHash();
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    signal.throwIfAborted();
    hash.update(new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer()));
    progress(`校验 ${Math.min(file.size, offset + chunkSize)} / ${file.size} 字节`);
  }
  const sha256 = hash.digest();
  signal.throwIfAborted();
  const session = await request<{ id: string; offset: number }>(
    url,
    'POST',
    { action: 'begin', sha256, bytes: file.size },
    signal,
  );
  for (let offset = session.offset; offset < file.size;) {
    signal.throwIfAborted();
    const bytes = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
    const next = await request<{ offset: number }>(
      url,
      'POST',
      { action: 'chunk', id: session.id, offset, data: encode(bytes) },
      signal,
    );
    if (next.offset !== offset + bytes.length) throw new Error('上传偏移校验失败');
    offset = next.offset;
    progress(`上传 ${offset} / ${file.size} 字节`);
  }
  const blob = await request<{ blobId: string; sha256: string; bytes: number }>(
    url,
    'POST',
    { action: 'complete', id: session.id },
    signal,
  );
  if (blob.sha256 !== sha256 || blob.bytes !== file.size) throw new Error('上传内容校验失败');
  return deliveryManifestSchema.parse(
    await request(
      url,
      'POST',
      {
        action: 'seal',
        label: file.name,
        kind: 'import',
        files: [{ ...blob, path: file.name, mode: 0o644 }],
      },
      signal,
    ),
  );
}
/** 持有下载租约并逐块验证后保存，失败或取消时尝试释放租约。
 * Hold a read lease while validating and saving blocks, attempting release on failure or cancellation.
 * 页面卸载或权限撤销使关闭请求不可用时，由绝对期限回收。
 * If unmount or revocation prevents the close request, the absolute expiry releases protection.
 * 支持文件选择器时流式落盘；其他浏览器上限 64 MiB。 Stream through a file picker, or cap the fallback at 64 MiB. */
export async function downloadDeliveryFile(
  request: Request,
  url: string,
  file: DeliveryFile,
  manifestId: string,
  signal: AbortSignal,
) {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{
        createWritable: () => Promise<{
          write: (data: Uint8Array) => Promise<void>;
          close: () => Promise<void>;
          abort: () => Promise<void>;
        }>;
      }>;
    }
  ).showSaveFilePicker;
  if (!picker && file.bytes > 64 * 1024 * 1024)
    throw new Error('当前浏览器不支持流式保存，大于 64 MiB 的文件请使用交付 CLI 导出');
  let writer;
  if (picker) {
    try {
      writer = await (await picker({ suggestedName: file.path.split('/').at(-1)! })).createWritable();
    } catch (error) {
      if (
        !(error instanceof DOMException) ||
        (error.name !== 'SecurityError' && error.name !== 'NotAllowedError')
      )
        throw error;
      if (file.bytes > 64 * 1024 * 1024)
        throw new Error('交付包已生成，请到制品仓库点击下载以选择保存位置，或使用交付 CLI');
    }
  }
  const buffers: Uint8Array<ArrayBuffer>[] = [],
    hash = new DeliveryHash();
  let lease: { token: string; expiresAt: string } | undefined;
  try {
    lease = z
      .object({ token: z.uuid(), expiresAt: z.iso.datetime() })
      .strict()
      .parse(await request(url, 'POST', { action: 'open-read', id: manifestId }, signal));
    for (let offset = 0; offset < file.bytes;) {
      signal.throwIfAborted();
      if (!lease || Date.now() >= Date.parse(lease.expiresAt))
        throw new Error('下载保护租约已到期，请重新下载');
      const result = await request<{ data: string; offset: number; eof: boolean; sha256: string }>(
        url,
        'POST',
        { action: 'read', blobId: file.blobId, offset, length: Math.min(chunkSize, file.bytes - offset) },
        signal,
      );
      const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
      if (
        !bytes.length ||
        bytes.length > Math.min(chunkSize, file.bytes - offset) ||
        result.offset > file.bytes ||
        result.offset !== offset + bytes.length ||
        result.eof !== (result.offset === file.bytes) ||
        result.sha256 !== file.sha256
      )
        throw new Error('下载分块身份不匹配');
      hash.update(bytes);
      if (writer) await writer.write(bytes);
      else buffers.push(bytes);
      offset = result.offset;
    }
    if (hash.digest() !== file.sha256) throw new Error('下载文件摘要不匹配');
    signal.throwIfAborted();
    if (writer) await writer.close();
    else {
      const object = URL.createObjectURL(new Blob(buffers)),
        link = document.createElement('a');
      link.href = object;
      link.download = file.path.split('/').at(-1)!;
      link.click();
      setTimeout(() => URL.revokeObjectURL(object), 1000);
    }
  } catch (error) {
    await writer?.abort().catch(() => {});
    throw error;
  } finally {
    if (lease)
      await request(
        url,
        'POST',
        { action: 'close-read', token: lease.token },
        AbortSignal.timeout(5000),
      ).catch(() => {});
  }
}
