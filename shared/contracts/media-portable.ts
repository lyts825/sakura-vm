import { z } from 'zod';
import * as M from './media-studio.ts';
import * as S from './suite-common.ts';
export const mediaJobEvidence = z
  .object({
    format: z.literal('sakura-media-job-evidence/1'),
    mode: z.enum(['inspect', 'transform']),
    sources: M.mediaJobInput.shape.sources,
    items: M.mediaJobInput.shape.items,
    result: M.mediaStoredResult,
    published: M.mediaJob.shape.published,
    executionState: z.literal('completed'),
    cleanup: z.literal('confirmed'),
    inputDigest: S.suiteDigest,
    tools: z.record(z.string().max(80), z.string().max(256)),
  })
  .strict();
export const mediaPortableSchemas: Record<string, z.ZodType> = {
  'media-sources': M.mediaPinned,
  'media-inspect': mediaJobEvidence,
  'media-recipes': M.mediaCompiled,
  'media-workers': mediaJobEvidence,
  'media-captions': M.mediaCaption,
  'media-collections': M.mediaCollection,
  'media-reviews': M.mediaReview,
};
