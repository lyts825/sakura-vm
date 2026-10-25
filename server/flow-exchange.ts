import * as S from '../shared/contracts/suite-common.ts';
import * as F from '../shared/contracts/flow-studio.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { SuiteExchange } from './suite-exchange.ts';
import { suitePortableProjection, portableKey } from './suite-portable-projection.ts';
import { suiteHash, suiteFail, type SuiteAuthorize } from './suite-store.ts';
import { flowPortable, flowSchemas, verifyFlowBundle } from './flow-offline.ts';
export class FlowExchange extends SuiteExchange {
  constructor(
    m: PluginMetadata,
    b: PluginMetadata,
    u: PluginMetadata,
    a: SuiteAuthorize,
    root: S.SuiteMaterialsV1,
    peers: Readonly<Record<string, S.SuiteRecordsV1>>,
  ) {
    super(
      'flow-exchange',
      m,
      b,
      u,
      a,
      root,
      peers,
      'sakura-flow-studio/1',
      (_domain, _kind, value) => S.suiteJson.parse(flowPortable.parse(value)),
      {
        sourceDomain: 'flow-inputs',
        receivedName: '接收的流程历史（不可执行）',
        verifyBundle: (bytes) => {
          verifyFlowBundle(bytes);
        },
        projection: suitePortableProjection({
          id: 'flow-history-v1',
          reportDomain: 'flow-runs',
          sourceDomain: 'flow-inputs',
          sources: root,
          peers,
          validate(rows, selected) {
            for (const r of selected) {
              const row = rows.get(portableKey(r))!;
              F.flowRun.parse(row.content);
            }
            for (const row of rows.values())
              if (row.kind !== 'source') {
                const schema = flowSchemas[row.domain as keyof typeof flowSchemas];
                if (!schema) suiteFail('FLOW_EXPORT_DOMAIN');
                schema.parse(row.content);
              }
          },
          claims(row, actor) {
            const value = structuredClone(row.content) as Record<string, S.SuiteJson>;
            const providerResults: S.SuiteJson[] = [];
            if (row.domain === 'flow-runs') {
              const run = F.flowRun.parse(value);
              for (const node of run.nodes)
                if (node.receipt)
                  providerResults.push(
                    S.suiteJson.parse({
                      nodeId: node.id,
                      status: node.receipt.status,
                      result: node.receipt.result,
                      receiptDigest: suiteHash(node.receipt),
                    }),
                  );
              value.nodes = S.suiteJson.parse(run.nodes.map((node) => ({ ...node, receipt: null })));
              value.generation = 'non-executable-history';
            }
            if (row.domain === 'flow-plans') {
              value.actor = actor;
              if (value.kind === 'step') {
                value.providerPlan = null;
                value.runGeneration = 'non-executable-history';
              }
            }
            if (row.domain === 'flow-approvals') {
              value.actor = actor;
              value.epoch = actor;
            }
            if (row.domain === 'flow-journal') {
              value.actor = actor;
              value.data = { sourceDataDigest: suiteHash(value.data) };
            }
            if (row.domain === 'flow-timers') value.actor = actor;
            return S.suiteJson.parse({ sourceId: row.id, value, providerResults });
          },
        }),
      },
    );
  }
}
