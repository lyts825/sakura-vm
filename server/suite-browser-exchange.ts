/** 仅交接已封存、资源核销的验收报告；外来声明不能启动或恢复浏览器。 */
import * as S from '../shared/contracts/suite-common.ts';
import * as B from '../shared/contracts/browser-lab.ts';
import { suitePortableClaim } from '../shared/contracts/suite-portable.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { SuiteExchange } from './suite-exchange.ts';
import { suiteFail, type SuiteAuthorize } from './suite-store.ts';
import { suitePortableProjection } from './suite-portable-projection.ts';
import { browserSchemas, verifyBrowserBundle } from './browser-offline.ts';
export class BrowserExchange extends SuiteExchange {
  constructor(
    meta: PluginMetadata,
    blobs: PluginMetadata,
    uploads: PluginMetadata,
    auth: SuiteAuthorize,
    root: S.SuiteMaterialsV1,
    peers: Readonly<Record<string, S.SuiteRecordsV1>>,
  ) {
    super(
      'browser-exchange',
      meta,
      blobs,
      uploads,
      auth,
      root,
      peers,
      'sakura-browser-lab/1',
      (_domain, _kind, value) => S.suiteJson.parse(suitePortableClaim.parse(value)),
      {
        sourceDomain: 'browser-targets',
        receivedName: '接收的浏览器验收来源声明',
        verifyBundle: (data) => {
          verifyBrowserBundle(data);
        },
        projection: suitePortableProjection({
          id: 'browser-sealed-v1',
          reportDomain: 'browser-reports',
          sourceDomain: 'browser-targets',
          sources: root,
          peers,
          validate(rows) {
            for (const row of rows.values()) {
              if (row.kind === 'source') continue;
              if (row.domain === 'browser-runners') {
                const run = B.browserRun.parse(row.content);
                if (run.cleanup !== 'confirmed' || ['prepared', 'running'].includes(run.executionState))
                  suiteFail('BROWSER_EXPORT_RUN_NOT_SETTLED');
              } else browserSchemas[row.domain].parse(row.content);
            }
          },
          claims(row, actor) {
            let content = browserSchemas[row.domain].parse(row.content);
            if (row.domain === 'browser-runners')
              content = { ...B.browserRun.parse(content), sessionId: actor };
            if (row.domain === 'browser-visual') {
              const baseline = B.browserBaseline.safeParse(content);
              if (baseline.success)
                content = { ...baseline.data, reviewer: baseline.data.reviewer ? actor : null };
            }
            if (row.domain === 'browser-accessibility') {
              const evaluation = B.browserAccessibilityEvaluation.parse(content);
              content = {
                ...evaluation,
                manualReview: evaluation.manualReview ? { ...evaluation.manualReview, actor } : null,
              };
            }
            return S.suiteJson.parse(content);
          },
        }),
      },
    );
  }
}
