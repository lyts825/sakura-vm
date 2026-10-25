import * as S from '../shared/contracts/suite-common.ts';
import * as M from '../shared/contracts/media-studio.ts';
import { mediaJobEvidence, mediaPortableSchemas } from '../shared/contracts/media-portable.ts';
import { suitePortableClaim } from '../shared/contracts/suite-portable.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { MediaSourcesV1, MediaReviewsV1 } from './service-contracts/media-studio.ts';
import { SuiteExchange } from './suite-exchange.ts';
import { suitePortableProjection, portableKey } from './suite-portable-projection.ts';
import { suiteFail, type SuiteAuthorize } from './suite-store.ts';
import { verifyMediaBundle } from './media-offline.ts';
export class MediaExchange extends SuiteExchange {
  constructor(
    meta: PluginMetadata,
    blobs: PluginMetadata,
    uploads: PluginMetadata,
    auth: SuiteAuthorize,
    sources: MediaSourcesV1,
    peers: Record<string, S.SuiteRecordsV1>,
  ) {
    const projection = suitePortableProjection({
      id: 'media-historical-v1',
      reportDomain: 'media-reviews',
      sourceDomain: 'media-sources',
      sources,
      peers,
      claims: (row) => {
        if (['media-inspect', 'media-workers'].includes(row.domain)) {
          const job = M.mediaJob.parse(row.content);
          if (!job.result || job.session?.state !== 'completed' || job.session.cleanup !== 'confirmed')
            suiteFail('MEDIA_EXPORT_JOB_PENDING');
          return S.suiteJson.parse(
            mediaJobEvidence.parse({
              format: 'sakura-media-job-evidence/1',
              mode: job.input.mode,
              sources: job.input.sources,
              items: job.input.items,
              result: job.result,
              published: job.published,
              executionState: 'completed',
              cleanup: 'confirmed',
              inputDigest: job.session.inputDigest,
              tools: job.session.tools,
            }),
          );
        }
        return S.suiteJson.parse(
          mediaPortableSchemas[row.domain]?.parse(row.content) ?? suiteFail('MEDIA_EXPORT_DOMAIN'),
        );
      },
      validate: async (rows, selected) => {
        for (const r of selected) {
          const row = rows.get(portableKey(r))!,
            review = M.mediaReview.parse(row.content);
          if (review.decision !== 'accepted' || !review.humanPreviewed)
            suiteFail('MEDIA_EXPORT_REVIEW_REQUIRED');
          await (peers['media-reviews'] as MediaReviewsV1).recheck({
            workspaceId: row.workspaceId,
            review: r,
          });
        }
      },
    });
    super(
      'media-exchange',
      meta,
      blobs,
      uploads,
      auth,
      sources,
      peers,
      'sakura-media-studio/1',
      (_domain, _kind, value) => S.suiteJson.parse(suitePortableClaim.parse(value)),
      {
        sourceDomain: 'media-sources',
        receivedName: '接收的媒体制作声明',
        projection,
        verifyBundle: (data) => {
          verifyMediaBundle(data);
        },
      },
    );
  }
}
