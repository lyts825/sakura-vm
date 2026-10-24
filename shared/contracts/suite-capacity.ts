/** 第三批插件包的宿主持久容量汇总，不包含其他空间的标识或正文。 */
import { z } from 'zod';
export const suiteHostCapacity = z.object({
  used: z.number().int().min(0),
  reserved: z.number().int().min(0),
  limit: z.number().int().positive(),
  ordinaryLimit: z.number().int().positive(),
  recoveryReserve: z.number().int().min(0),
  retainedMetadataBytes: z.number().int().min(0),
  packs: z.number().int().min(0),
}).strict();
export type SuiteHostCapacity = z.infer<typeof suiteHostCapacity>;
