/** 原插件在受管执行窗口中读取快照；只签发本代次、实际消费者和原运行身份的凭据。 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import * as C from '../shared/contracts/incident-snapshots.ts';
import * as S from '../shared/contracts/suite-common.ts';
import type { PluginExecutionScope } from './plugin-capabilities.ts';
import type { PluginInstance } from './plugin-instance.ts';
import type { IncidentSnapshotProvider as Provider } from './service-contracts/incident-snapshots.ts';
import { captureOperationCheck } from './operation-context.ts';
import { resourceContext } from './host-runtime/context.ts';
import { pluginAuthority } from './plugin-authority.ts';
import { suiteCanonical, suiteHash } from './suite-store.ts';
type Window = <T>(
  target: C.IncidentSnapshotTarget,
  work: (scope: PluginExecutionScope) => Promise<T>,
) => Promise<T>;
function fail(message = '原快照身份或权限已改变'): never {
  throw new AppError(message, 409, 'INCIDENT_SNAPSHOT_STALE');
}
export class IncidentSnapshotProvider implements Provider {
  private key = randomBytes(32);
  private instance: PluginInstance;
  private closed = false;
  constructor(
    private kind: 'metrics' | 'health',
    private window: Window,
    private read: (target: C.IncidentSnapshotTarget) => Promise<S.SuiteJson>,
    private configuration: (target: C.IncidentSnapshotTarget) => Promise<S.SuiteJson> = async () => null,
    private now = Date.now,
  ) {
    const instance = pluginAuthority();
    if (
      !instance ||
      instance.source !== 'official' ||
      instance.pluginId !== (kind === 'metrics' ? 'metrics' : 'service-health')
    )
      fail('只读采集须由原提供者装配');
    this.instance = instance;
  }
  private identity() {
    this.instance.check('services', true);
    const context = resourceContext(),
      actor = S.suiteId.safeParse(context?.actorId);
    if (
      this.closed ||
      !actor.success ||
      context?.serviceConsumerPluginInstanceId !== 'official:incident-evidence' ||
      !context.serviceConsumerPluginGeneration
    )
      fail('缺少实际采集消费者或 owner');
    return {
      actorId: actor.data,
      consumer: 'official:incident-evidence' as const,
      consumerGeneration: context.serviceConsumerPluginGeneration,
    };
  }
  private sign(value: unknown) {
    return createHmac('sha256', this.key).update(suiteCanonical(value)).digest('hex');
  }
  private async fingerprint(target: C.IncidentSnapshotTarget, scope: PluginExecutionScope) {
    scope.assert();
    const { operationId: _operationId, ...identity } = scope.identity;
    if (identity.vmId !== target.vmId || identity.projectId !== target.projectId) fail();
    const configuration = await this.configuration(target);
    scope.assert();
    return suiteHash({ identity, configuration });
  }
  async readSnapshot(raw: C.IncidentSnapshotTarget): Promise<C.IncidentSnapshot> {
    const target = C.incidentSnapshotTarget.parse(raw),
      identity = this.identity(),
      check = captureOperationCheck();
    await check();
    return this.window(target, async (scope) => {
      const before = await this.fingerprint(target, scope),
        data = S.suiteJson.parse(await this.read(target));
      if (Buffer.byteLength(JSON.stringify(data, null, 2)) > 512 * 1024)
        fail('原快照超过 512 KiB，请选择较小范围');
      if ((await this.fingerprint(target, scope)) !== before) fail();
      await check();
      this.identity();
      scope.assert();
      const capturedAt = new Date(this.now()).toISOString(),
        base = {
          kind: this.kind,
          target,
          ...identity,
          provider: this.instance.identity,
          providerGeneration: this.instance.generation,
          scopeDigest: before,
          snapshotDigest: suiteHash(data),
          capturedAt,
          expiresAt: new Date(Date.parse(capturedAt) + 300000).toISOString(),
        };
      const binding = C.incidentSnapshotBinding.parse({ ...base, authTag: this.sign(base) });
      return { binding, data };
    });
  }
  async verifySnapshot(raw: C.IncidentSnapshotBinding): Promise<{ confirmed: true }> {
    const binding = C.incidentSnapshotBinding.parse(raw),
      current = this.identity(),
      { authTag, ...base } = binding;
    if (
      binding.kind !== this.kind ||
      binding.provider !== this.instance.identity ||
      binding.providerGeneration !== this.instance.generation ||
      binding.actorId !== current.actorId ||
      binding.consumer !== current.consumer ||
      binding.consumerGeneration !== current.consumerGeneration ||
      Date.parse(binding.expiresAt) <= this.now() ||
      Date.parse(binding.expiresAt) - Date.parse(binding.capturedAt) !== 300000 ||
      !timingSafeEqual(Buffer.from(authTag, 'hex'), Buffer.from(this.sign(base), 'hex'))
    )
      fail();
    await captureOperationCheck()();
    return this.window(binding.target, async (scope) => {
      if ((await this.fingerprint(binding.target, scope)) !== binding.scopeDigest) fail();
      await captureOperationCheck()();
      this.identity();
      scope.assert();
      return { confirmed: true };
    });
  }
  close() {
    this.closed = true;
    this.key.fill(0);
  }
}
