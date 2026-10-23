/** 验证制品字节后才交给报告和交接服务。 Verify artifact bytes before parsing or handoff. */
import { AppError } from '../shared/errors.ts';
import type { DeliveryScope, DeliveryFile } from '../shared/contracts/delivery-common.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import { qualityHash } from './delivery-quality-store.ts';
/** 从 artifacts 分块读取 scope 中的 file，限制总字节并核对 SHA-256，返回缓冲区。 Read file from scoped artifacts in chunks, enforce limit and SHA-256, then return its buffer. */
export async function readDeliveryFile(
  artifacts: DeliveryArtifactsV1,
  scope: DeliveryScope,
  file: DeliveryFile,
  limit = 128 * 1024 * 1024,
) {
  if (file.bytes > limit) throw new AppError('交付文件超过当前操作上限', 413);
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < file.bytes) {
    const part = await artifacts.read(scope, file.blobId, offset, Math.min(512 * 1024, file.bytes - offset));
    const bytes = Buffer.from(part.data, 'base64');
    if (!bytes.length || bytes.length > file.bytes - offset) throw new AppError('制品读取不完整', 409);
    chunks.push(bytes);
    offset += bytes.length;
  }
  const bytes = Buffer.concat(chunks);
  if (qualityHash(bytes) !== file.sha256) throw new AppError('制品摘要不符', 409);
  return bytes;
}
