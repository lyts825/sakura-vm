/** 环境地址与完整秘密版本集合；只有运行器可解密。 Frozen destinations and versioned secret sets. */
import { z } from 'zod';
import { networkInterfaces } from 'node:os';
import type { SecretsV1 } from './service-contracts/v1.ts';
import type { AppTargetsV1 } from './service-contracts/app-runtime.ts';
import type { IntegrationEnvironmentsV1, IntegrationSpecsV1 } from './service-contracts/integration-lab.ts';
import type { IntegrationMetadataFactory } from './integration-specs.ts';
import { IntegrationDefinitions, IntegrationRows, ilConsumer, ilFail, ilHash } from './integration-store.ts';
import {
  environmentSchema,
  ilRef,
  type IntegrationEnvironment,
  type IntegrationScope,
  type IntegrationRef,
} from '../shared/contracts/integration-lab.ts';
export function validateIntegrationAddress(address: string) {
  if(Object.values(networkInterfaces()).flat().some(item=>item?.address===address))ilFail('DESTINATION_FORBIDDEN');
  const [a, b] = address.split('.').map(Number);
  if (
    !(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) ||
    ['10.0.2.2', '10.0.2.3', '10.0.2.15'].includes(address) ||
    address.endsWith('.0') ||
    address.endsWith('.255')
  )
    ilFail('DESTINATION_FORBIDDEN');
}
export class IntegrationEnvironments
  extends IntegrationDefinitions<IntegrationEnvironment>
  implements IntegrationEnvironmentsV1
{
  private revoked;
  constructor(
    meta: IntegrationMetadataFactory,
    specs: IntegrationSpecsV1,
    private secrets: SecretsV1,
    private applications?: () => AppTargetsV1 | undefined,
  ) {
    super(meta('environments'), environmentSchema, specs, 'environments');
    this.revoked = new IntegrationRows(
      meta('revocations'),
      z.object({ workspaceId: z.uuid(), ref: ilRef, at: z.iso.datetime() }).strict(),
    );
  }
  protected override async validate(_scope: IntegrationScope, content: IntegrationEnvironment) {
    if (content.application) {
      const apps = await this.applicationTargets(_scope);
      if (
        !apps.available ||
        !apps.targets.some(
          (t) =>
            t.appId === content.application!.appId &&
            t.revision === content.application!.revision &&
            t.identityDigest === content.application!.identityDigest,
        )
      )
        ilFail('APPLICATION_TARGET_CHANGED');
      if (content.target.kind !== 'private') ilFail('APPLICATION_FUNCTIONAL_TARGET_ONLY');
    }
    if (content.target.kind === 'private') {
      validateIntegrationAddress(content.target.address);
      if (content.target.protocol === 'https' && !content.target.tlsName) ilFail('TLS_NAME_REQUIRED');
    }
    const headers = new Set<string>();
    for (const slot of content.credentials) {
      const name = slot.header.toLowerCase();
      if (
        headers.has(name) ||
        ['host', 'content-length', 'connection', 'transfer-encoding', 'proxy-authorization'].includes(name)
      )
        ilFail('CREDENTIAL_HEADER_FORBIDDEN');
      headers.add(name);
      if ([slot.sourceVmId, slot.name, slot.version].filter(Boolean).length % 3)
        ilFail('SECRET_BINDING_INCOMPLETE');
      if (slot.sourceVmId) {
        const versions = await this.secrets.references(slot.sourceVmId, { [slot.header]: slot.name! });
        if (versions[slot.header]?.version !== slot.version) ilFail('SECRET_VERSION_CHANGED');
      }
    }
  }
  async applicationTargets(scope: IntegrationScope) {
    await this.specs.assertWorkspace({ ...scope, allowImporting: true });
    const service = this.applications?.();
    if (!service) return { available: false, targets: [] };
    const view = await service.view();
    return {
      available: true,
      targets: view.targets
        .filter((t) => t.state === 'ready')
        .map((t) => ({
          appId: t.appId,
          name: t.name,
          revision: t.revision,
          identityDigest: ilHash({
            vmId: t.vmId,
            createdAt: t.vmCreatedAt,
            bootId: t.bootId,
            disk: t.diskIdentity,
            project: t.projectId,
          }),
        })),
    };
  }
  async versions(scope: IntegrationScope, ref: IntegrationRef) {
    const row = await this.get(scope, ref);
    if (
      (await this.revoked.all()).some(
        (v) => v.workspaceId === scope.workspaceId && ilHash(v.ref) === ilHash(ref),
      )
    )
      ilFail('ENVIRONMENT_REVOKED');
    if (row.state !== 'sealed' || row.content.target.kind === 'unbound') ilFail('ENVIRONMENT_NOT_BOUND');
    await this.validate(scope, row.content);
    const versions: Record<string, string> = {};
    for (const slot of row.content.credentials) {
      if (!slot.sourceVmId) ilFail('SECRET_SLOT_UNBOUND');
      versions[slot.header] = slot.version!;
    }
    return versions;
  }
  async resolve(scope: IntegrationScope, ref: IntegrationRef, versions: Record<string, string>) {
    ilConsumer('integration-runners');
    if (ilHash(await this.versions(scope, ref)) !== ilHash(versions)) ilFail('SECRET_VERSION_CHANGED');
    const row = await this.get(scope, ref);
    const result: Record<string, string> = {};
    for (const vmId of new Set(row.content.credentials.map((v) => v.sourceVmId!))) {
      const slots = row.content.credentials.filter((v) => v.sourceVmId === vmId);
      Object.assign(
        result,
        await this.secrets.resolveVersioned(
          vmId,
          Object.fromEntries(slots.map((v) => [v.header, v.name!])),
          Object.fromEntries(slots.map((v) => [v.header, versions[v.header]])),
        ),
      );
    }
    return result;
  }
  async revoke(scope: IntegrationScope, ref: IntegrationRef) {
    await this.get(scope, ref);
    await this.revoked.change((rows) => {
      if (!rows.some((v) => v.workspaceId === scope.workspaceId && ilHash(v.ref) === ilHash(ref)))
        rows.push({ workspaceId: scope.workspaceId, ref, at: new Date().toISOString() });
    });
  }
  override async close() {
    await super.close();
    await this.revoked.close();
  }
}
