import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assessHaDrillSample, type HaDrillPlan, type HaDrillSample } from '../server/ha-witness-drill.ts';

const replica = { sourceHostId: randomUUID(), sourceVmId: randomUUID(), targetHostId: randomUUID(),
  transferId: randomUUID(), remoteVmId: randomUUID(), snapshotId: randomUUID(), sha256: 'a'.repeat(64),
  snapshotAt: new Date().toISOString(), maxReplicaAgeMinutes: 60 };
const plan: HaDrillPlan = { version: 1, kind: 'sakura-ha-drill-plan', drillId: randomUUID(),
  createdAt: new Date().toISOString(), witnessNode: 'fixture', configDigest: 'b'.repeat(64),
  sourceSystemUuid: randomUUID(), failureThreshold: 2, replica,
  endpoints: { witness: 'https://witness.invalid/', redfishSystem: 'https://bmc.invalid/redfish/v1/Systems/1',
    target: 'https://target.invalid/', application: 'https://app.invalid/health', traffic: 'https://traffic.invalid/' },
  operatorSteps: ['Review the real hardware identities before fault injection.'] };
const healthy: HaDrillSample = { at: new Date().toISOString(), ok: true, stable: true,
  phase: 'promoted', planMatches: true, sourceStartAllowed: false,
  observed: { powerState: 'Off', targetHostId: replica.targetHostId, targetVmId: replica.remoteVmId,
    targetStatus: 'running', applicationVmId: replica.remoteVmId, applicationReady: true,
    activeVmId: replica.remoteVmId } };

test('drill success needs authenticated source refusal, exact target, health and confirmed routing together', () => {
  assert.equal(assessHaDrillSample(plan, healthy).complete, true);
  for (const sample of [
    { ...healthy, ok: false }, { ...healthy, sourceStartAllowed: undefined },
    { ...healthy, observed: { ...healthy.observed, powerState: undefined } },
    { ...healthy, observed: { ...healthy.observed, targetHostId: randomUUID() } },
    { ...healthy, observed: { ...healthy.observed, targetVmId: randomUUID() } },
    { ...healthy, observed: { ...healthy.observed, targetStatus: 'starting' as const } },
    { ...healthy, observed: { ...healthy.observed, applicationReady: false } },
    { ...healthy, observed: { ...healthy.observed, activeVmId: replica.sourceVmId } },
  ]) assert.equal(assessHaDrillSample(plan, sample).complete, false);
});

test('unavailable or transitioning reads cannot prove a fence or a split-brain violation', () => {
  assert.deepEqual(assessHaDrillSample(plan, { at: healthy.at, ok: false, stable: false,
    error: 'TLS connection refused' }), { complete: false, violation: null });
  assert.deepEqual(assessHaDrillSample(plan, { ...healthy, stable: false, phase: 'source',
    sourceStartAllowed: true, observed: { ...healthy.observed, powerState: 'On' } }),
  { complete: false, violation: null });
});

test('stable unsafe authority, early target starts, a revived source and changed plans fail the drill', () => {
  for (const sample of [
    { ...healthy, sourceStartAllowed: true },
    { ...healthy, phase: 'fencing' },
    { ...healthy, phase: 'fenced', observed: { ...healthy.observed, powerState: 'On' } },
    { ...healthy, planMatches: false },
  ]) {
    const result = assessHaDrillSample(plan, sample);
    assert.equal(result.complete, false);
    assert.equal(typeof result.violation, 'string');
  }
});
