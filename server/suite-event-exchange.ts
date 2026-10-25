/** 原图每次重新检查导出许可；会话只投影为不可执行的历史声明。 */
import * as S from '../shared/contracts/suite-common.ts';
import * as E from '../shared/contracts/event-lab.ts';
import { suitePortableClaim } from '../shared/contracts/suite-portable.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { SuiteExchange } from './suite-exchange.ts';
import { suiteFail, type SuiteAuthorize } from './suite-store.ts';
import { suitePortableProjection } from './suite-portable-projection.ts';
import { eventSchemas, eventSessionHistory, verifyEventBundle } from './event-offline.ts';
export class EventExchange extends SuiteExchange {
  constructor(
    meta: PluginMetadata,
    blobs: PluginMetadata,
    uploads: PluginMetadata,
    auth: SuiteAuthorize,
    contracts: S.SuiteMaterialsV1,
    peers: Readonly<Record<string, S.SuiteRecordsV1>>,
  ) {
    super(
      'event-exchange',
      meta,
      blobs,
      uploads,
      auth,
      contracts,
      peers,
      'sakura-event-lab/1',
      (_domain, _kind, value) => S.suiteJson.parse(suitePortableClaim.parse(value)),
      {
        sourceDomain: 'event-contracts',
        receivedName: '接收的事件实验声明',
        verifyBundle: (data) => {
          verifyEventBundle(data);
        },
        projection: suitePortableProjection({
          id: 'event-sealed-v1',
          reportDomain: 'event-reports',
          sourceDomain: 'event-contracts',
          sources: contracts,
          peers,
          validate(rows) {
            for (const row of rows.values()) {
              if (row.kind === 'source') continue;
              const session = E.eventSession.safeParse(row.content);
              if (session.success) {
                if (
                  !session.data.session ||
                  session.data.session.cleanup !== 'confirmed' ||
                  ['preparing', 'running'].includes(session.data.session.state)
                )
                  suiteFail('EVENT_EXPORT_UNSETTLED');
              } else eventSchemas[row.domain].parse(row.content);
            }
          },
          claims(row, actor) {
            const session = E.eventSession.safeParse(row.content);
            if (session.success) {
              const value = session.data;
              return S.suiteJson.parse(
                eventSessionHistory.parse({
                  format: 'sakura-event-session-history/1',
                  broker: value.broker,
                  scenario: value.scenario,
                  state: value.session!.state,
                  outcome: value.session!.outcome,
                  cleanup: value.session!.cleanup,
                  result: value.result ? { ...value.result, sessionId: actor } : null,
                  executionAllowed: false,
                }),
              );
            }
            if (row.domain === 'event-assertions')
              return S.suiteJson.parse({
                ...E.eventAssessment.parse(row.content),
                sourceTrust: 'unauthenticated',
              });
            if (row.domain === 'event-reports') {
              const report = E.eventReport.parse(row.content);
              return S.suiteJson.parse({
                ...report,
                sealedBy: actor,
                assessment: { ...report.assessment, sourceTrust: 'unauthenticated' },
              });
            }
            return S.suiteJson.parse(eventSchemas[row.domain].parse(row.content));
          },
        }),
      },
    );
  }
}
