/** 独立交付签名用途；仅服务端读取私密引用，私钥不进入记录或响应。
 * Delivery-specific signing reads secrets only on the server and never returns or persists private keys. */
import { createPrivateKey, sign } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import type { SecretsV1 } from './service-contracts/v1.ts';
import type { DeliverySigner } from './delivery-releases.ts';
const keySchema = z
  .object({
    keyId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    publisher: z.string().min(1).max(200),
    privateKey: z.string().max(8192),
  })
  .strict();
/** 按需借用私密服务，用指定项目的 Ed25519 密钥签署字节；错误不包含密钥原文。
 * Borrow the optional secrets service to sign bytes with the scoped Ed25519 key, redacting key material from errors. */
export function deliverySigner(provider: () => SecretsV1 | undefined): DeliverySigner {
  return async (scope, reference, message) => {
    const secrets = provider();
    if (!secrets) throw new AppError('请启用私密配置插件后使用签名引用', 503);
    let configured: z.infer<typeof keySchema>;
    try {
      configured = keySchema.parse(JSON.parse(await secrets.value(scope.vmId, reference)));
    } catch {
      throw new AppError('交付签名引用不可读取，或缺少 keyId、publisher、privateKey', 409);
    }
    try {
      const key = createPrivateKey(configured.privateKey);
      if (key.asymmetricKeyType !== 'ed25519') throw new Error('key type');
      return {
        keyId: configured.keyId,
        publisher: configured.publisher,
        signature: sign(null, message, key).toString('base64'),
      };
    } catch {
      throw new AppError('交付私钥必须是有效的 Ed25519 PEM', 409);
    }
  };
}
