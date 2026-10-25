import * as S from '../shared/contracts/suite-common.ts';
import * as L from '../shared/contracts/learning-lab.ts';
import { suitePortableClaim } from '../shared/contracts/suite-portable.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { SuiteExchange } from './suite-exchange.ts';
import { suiteFail, type SuiteAuthorize } from './suite-store.ts';
import { suitePortableProjection } from './suite-portable-projection.ts';
import { learningSchemas, verifyLearningBundle } from './learning-offline.ts';
export class LearningExchange extends SuiteExchange {
  constructor(
    m: PluginMetadata,
    b: PluginMetadata,
    u: PluginMetadata,
    a: SuiteAuthorize,
    root: S.SuiteMaterialsV1,
    peers: Readonly<Record<string, S.SuiteRecordsV1>>,
  ) {
    super(
      'learning-exchange',
      m,
      b,
      u,
      a,
      root,
      peers,
      'sakura-learning-lab/1',
      (_d, _k, v) => S.suiteJson.parse(suitePortableClaim.parse(v)),
      {
        sourceDomain: 'learning-assets',
        receivedName: '接收的自学课程与个人声明',
        verifyBundle: (data) => {
          verifyLearningBundle(data);
        },
        projection: suitePortableProjection({
          id: 'learning-sealed-v1',
          reportDomain: 'learning-assessments',
          sourceDomain: 'learning-assets',
          sources: root,
          peers,
          validate(rows) {
            for (const row of rows.values()) {
              if (row.kind === 'source') continue;
              learningSchemas[row.domain].parse(row.content);
              if (row.domain === 'learning-sessions') {
                const s = L.learningSession.parse(row.content);
                if (s.pending || s.cleanup !== 'confirmed') suiteFail('LEARNING_EXPORT_UNSETTLED');
              }
              if (
                row.domain === 'learning-assessments' &&
                L.learningAssessment.parse(row.content).status !== 'sealed'
              )
                suiteFail('LEARNING_EXPORT_REPORT_UNSEALED');
            }
          },
          claims(row, actor) {
            let value = learningSchemas[row.domain].parse(row.content);
            if (row.domain === 'learning-sessions') {
              const v = L.learningSession.parse(value);
              value = {
                ...v,
                attempts: v.attempts.map((a) => ({
                  ...a,
                  coreId: actor,
                  result: a.result ? { ...a.result, sessionId: actor } : null,
                })),
              };
            }
            if (row.domain === 'learning-progress') value = { ...L.learningProgress.parse(value), actor };
            if (row.domain === 'learning-assessments') {
              const v = L.learningAssessment.parse(value);
              value = { ...v, selfReview: v.selfReview ? { ...v.selfReview, actor } : null };
            }
            if (row.domain === 'learning-environments') {
              const c = L.learningCheckpoint.safeParse(value);
              if (c.success) value = { ...c.data, originalAttempt: actor };
            }
            return S.suiteJson.parse(value);
          },
        }),
      },
    );
  }
}
