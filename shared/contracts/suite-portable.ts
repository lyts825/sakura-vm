/** 便携结果是来源声明；不携带授权或可恢复执行能力。 */
import {z} from 'zod';
import {suiteDigest,suiteJson} from './suite-common.ts';
export const suitePortableClaim=z.object({format:z.literal('sakura-suite-portable-claim/1'),sourceTrust:z.literal('unauthenticated'),approvalsTransferred:z.literal(false),executionAllowed:z.literal(false),sourceRecordDigest:suiteDigest,claims:suiteJson}).strict();
