/** 候选摘要不包含报告、门禁或预览，避免证据循环。 Candidate digests exclude reports, gates and previews. */
import { createHash } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import {
  deliveryCandidateSchema,
  type DeliveryCandidate,
  type DeliveryScope,
} from '../shared/contracts/delivery-common.ts';
/** 从 value 的执行身份字段返回 SHA-256，不写状态。 Hash execution identity fields of value without state changes. */
export function deliveryCandidateDigest(value: Omit<DeliveryCandidate, 'digest'> | DeliveryCandidate) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        scope: value.scope,
        inputId: value.inputId,
        inputDigest: value.inputDigest,
        runId: value.runId,
        manifestId: value.manifestId,
        manifestDigest: value.manifestDigest,
        environment: value.environment,
        startup: value.startup,
        origin: value.origin,
      }),
    )
    .digest('hex');
}
/** 校验 value 的结构、scope 和摘要，返回规范化候选或抛错。 Validate value against scope and digest; return normalized data or throw. */
export function assertDeliveryCandidate(scope: DeliveryScope, value: DeliveryCandidate) {
  const parsed = deliveryCandidateSchema.parse(value);
  if (
    parsed.scope.vmId !== scope.vmId ||
    parsed.scope.projectId !== scope.projectId ||
    deliveryCandidateDigest(parsed) !== parsed.digest
  )
    throw new AppError('候选范围或摘要不匹配', 409);
  return parsed;
}
