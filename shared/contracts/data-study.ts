/** 数据研究容器的独立 schema，不能替代运行授权或发布者信任。 */
import { z } from 'zod';
import { dataDatasetSchema, dataDigestSchema, dataEvidenceSchema, dataRunSchema } from './data-common.ts';
import { deliveryManifestSchema } from './delivery-common.ts';
export const dataStudySchema = z
  .object({
    type: z.literal('sakura-data-study-v1'),
    schemaVersion: z.literal(1),
    coreDigest: dataDigestSchema,
    signature: z.literal('unsupported'),
    datasets: z
      .array(z.object({ dataset: dataDatasetSchema, manifest: deliveryManifestSchema }).strict())
      .min(1)
      .max(128),
    executions: z
      .array(
        z
          .object({ evidence: dataEvidenceSchema, run: dataRunSchema, manifest: deliveryManifestSchema })
          .strict(),
      )
      .max(32)
      .default([]),
    missingOutputDatasets: z.array(z.uuid()).max(32).default([]),
    missingEnvironmentImages: z.array(dataDigestSchema).max(32).default([]),
    missingAncestors: z.array(dataDigestSchema).max(1000),
    reproducibility: z.literal('declared-inputs-and-evidence'),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DataStudy = z.infer<typeof dataStudySchema>;
