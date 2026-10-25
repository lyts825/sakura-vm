/** 离线重算固定消息轨迹与结论关系，外来来源始终不具执行可信性。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as E from '../shared/contracts/event-lab.ts';
import { eventWorkerOutput } from '../shared/contracts/suite-execution-event.ts';
import { suitePortableClaim } from '../shared/contracts/suite-portable.ts';
import { verifySuiteGraph, offlineHash, offlineKey } from './suite-offline.ts';
import { evaluateEventEvidence } from '../shared/event-evidence.ts';
export const eventSessionHistory = z
  .object({
    format: z.literal('sakura-event-session-history/1'),
    broker: S.suiteRef,
    scenario: S.suiteRef,
    state: z.enum(['completed', 'failed', 'cancelled', 'interrupted']),
    outcome: z.enum(['passed', 'failed', 'inconclusive', 'not-supported']),
    cleanup: z.literal('confirmed'),
    result: eventWorkerOutput.nullable(),
    executionAllowed: z.literal(false),
  })
  .strict();
export const eventDomains = [
  'contracts',
  'fixtures',
  'producers',
  'consumers',
  'scenarios',
  'brokers',
  'runs',
  'assertions',
  'reports',
].map((id) => 'event-' + id);
export const eventSchemas: Record<string, z.ZodType> = {
  'event-contracts': E.eventContract,
  'event-fixtures': E.eventFixture,
  'event-producers': E.eventProducer,
  'event-consumers': E.eventConsumer,
  'event-scenarios': E.eventScenario,
  'event-brokers': z.union([E.eventBroker, eventSessionHistory]),
  'event-runs': E.eventRun,
  'event-assertions': E.eventAssessment,
  'event-reports': E.eventReport,
};
export function verifyEventBundle(bytes: Uint8Array) {
  const graph = verifySuiteGraph(bytes, 'sakura-event-lab/1', eventDomains, 'event-contracts'),
    claims = new Map<string, unknown>();
  let reports = 0,
    sessions = 0;
  for (const row of graph.rows) {
    if (row.origin !== 'imported') throw new Error('EVENT_PORTABLE_ORIGIN');
    if (row.kind === 'source') continue;
    claims.set(offlineKey(row), eventSchemas[row.domain].parse(suitePortableClaim.parse(row.content).claims));
  }
  const get = <T>(r: S.SuiteRef, schema: z.ZodType<T>, owner?: S.SuiteRecord) =>
    schema.parse(claims.get(offlineKey(graph.get(r, owner))));
  for (const row of graph.rows) {
    if (row.kind === 'source') continue;
    const value = claims.get(offlineKey(row));
    if (row.domain === 'event-fixtures') {
      const v = E.eventFixture.parse(value),
        source = graph.get(v.source, row),
        data = graph.materials.get(offlineKey(source));
      get(v.contract, E.eventContract, row);
      if (
        !data ||
        offlineHash(JSON.parse(data.toString('utf8'))) !== v.digest ||
        offlineHash(v.messages) !== v.digest
      )
        throw new Error('EVENT_FIXTURE_DIGEST');
    }
    if (row.domain === 'event-producers') {
      const v = E.eventProducer.parse(value),
        fixture = get(v.fixture, E.eventFixture, row);
      if (
        v.messageIds.length !== fixture.messages.length ||
        new Set(v.messageIds).size !== v.messageIds.length ||
        v.messageIds.some((id) => !fixture.messages.some((m) => m.id === id))
      )
        throw new Error('EVENT_PRODUCER_COVERAGE');
    }
    if (row.domain === 'event-consumers') {
      const v = E.eventConsumer.parse(value);
      get(v.contract, E.eventContract, row);
    }
    if (row.domain === 'event-scenarios') {
      const v = E.eventScenario.parse(value),
        fixture = get(v.fixture, E.eventFixture, row),
        producer = get(v.producer, E.eventProducer, row),
        consumer = get(v.consumer, E.eventConsumer, row);
      const expected = {
        protocol: 'sakura-event-tool/1',
        experiment: v.manifest.experiment,
        messages: producer.messageIds.map((id) => fixture.messages.find((m) => m.id === id)),
        ordering: producer.ordering,
        idempotent: consumer.idempotent,
        delayMs: consumer.delayMs,
        retryLimit: consumer.retryLimit,
        poisonIds: consumer.poisonIds,
      };
      if (
        offlineHash(expected) !== v.digest ||
        offlineHash(v.manifest) !== v.digest ||
        offlineKey(producer.fixture) !== offlineKey(v.fixture) ||
        offlineKey(consumer.contract) !== offlineKey(fixture.contract)
      )
        throw new Error('EVENT_SCENARIO_BINDING');
    }
    if (row.domain === 'event-brokers') {
      const v = eventSessionHistory.safeParse(value);
      if (v.success) {
        get(v.data.broker, E.eventBroker, row);
        const scenario = get(v.data.scenario, E.eventScenario, row);
        if (v.data.result) {
          if (v.data.result.inputDigest !== scenario.digest) throw new Error('EVENT_SESSION_INPUT');
          const evaluated = evaluateEventEvidence(scenario.manifest, v.data.result);
          if (v.data.state === 'completed' && evaluated.outcome !== v.data.outcome)
            throw new Error('EVENT_SESSION_RESULT');
        }
        sessions++;
      }
    }
    if (row.domain === 'event-runs') {
      const v = E.eventRun.parse(value),
        session = get(v.brokerSession, eventSessionHistory, row);
      get(v.scenario, E.eventScenario, row);
      if (
        offlineKey(v.scenario) !== offlineKey(session.scenario) ||
        v.state !== session.state ||
        v.outcome !== session.outcome ||
        v.cleanup !== session.cleanup
      )
        throw new Error('EVENT_RUN_BINDING');
    }
    if (row.domain === 'event-assertions') {
      const v = E.eventAssessment.parse(value),
        run = get(v.run, E.eventRun, row),
        session = get(v.brokerSession, eventSessionHistory, row),
        scenario = get(run.scenario, E.eventScenario);
      if (
        offlineKey(run.brokerSession) !== offlineKey(v.brokerSession) ||
        v.sourceTrust !== 'unauthenticated'
      )
        throw new Error('EVENT_ASSESSMENT_BINDING');
      if (session.result) {
        const observed = evaluateEventEvidence(scenario.manifest, session.result);
        for (const key of [
          'produced',
          'delivered',
          'acknowledged',
          'deduplicated',
          'deadLetters',
          'remaining',
        ] as const)
          if (observed[key] !== v[key]) throw new Error('EVENT_ASSESSMENT_COUNTS');
        if (
          session.state === 'completed' &&
          (observed.outcome !== v.outcome || observed.coverage !== v.coverage)
        )
          throw new Error('EVENT_ASSESSMENT_RESULT');
      } else if (v.outcome !== 'inconclusive' || v.coverage !== 'incomplete')
        throw new Error('EVENT_ASSESSMENT_MISSING');
    }
    if (row.domain === 'event-reports') {
      const v = E.eventReport.parse(value),
        assertion = get(v.assertion, E.eventAssessment, row),
        run = get(v.run, E.eventRun, row);
      if (
        offlineHash(v.assessment) !== offlineHash(assertion) ||
        offlineKey(assertion.run) !== offlineKey(v.run) ||
        run.cleanup !== 'confirmed'
      )
        throw new Error('EVENT_REPORT_RESULT');
      reports++;
    }
  }
  if (!reports) throw new Error('EVENT_REPORT_REQUIRED');
  return {
    format: 'sakura-event-lab/1',
    valid: true,
    objects: graph.rows.length,
    reports,
    sessions,
    sourceTrust: 'unauthenticated',
    executionVerified: false,
    approvalsTransferred: false,
    manifestDigest: graph.manifestDigest,
  };
}
