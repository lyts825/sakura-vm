/**
 * 模块职责：装配并关闭平台领域服务，汇总清理失败以保留未完成的资源归属。
 */
import type { SnapshotMergeV1, WorkspacesV1 } from './service-contracts/v1.ts';
import { StorageTiering } from './storage-tiering.ts';
import { ServiceMesh } from './service-mesh.ts';
import { VtpmEnrollment } from './vtpm-enrollment.ts';
import { AcmeRenewal } from './acme-renewal.ts';
import { TeamTemplates } from './team-templates.ts';
import { HaFailureMonitor } from './ha-failure-monitor.ts';
import type { VmAccess } from './vm-access.ts';

import type { HostServiceResolver } from './host-service-contracts.ts';
import type { ObjectBackup } from './object-backup.ts';
import type { WireGuardOverlay } from './wireguard-overlay.ts';

export type PlatformDomains = { objectBackup?: ObjectBackup; wireGuardOverlay?: WireGuardOverlay;
  snapshotMerge?: () => SnapshotMergeV1 | undefined };
/** Domain ownership is separate from the API/catalog composition facade. */
export class PlatformDomainServices {
  readonly storageTiering: StorageTiering; readonly serviceMesh: ServiceMesh;
  readonly vtpmEnrollment: VtpmEnrollment; readonly acmeRenewal: AcmeRenewal;
  readonly teamTemplates: TeamTemplates; readonly haFailureMonitor: HaFailureMonitor;
  constructor(machines: VmAccess, workspaces: WorkspacesV1, dependencies: HostServiceResolver,
    policy: ConstructorParameters<typeof HaFailureMonitor>[1], enabled: (id: string) => Promise<boolean>,
    readonly optional: PlatformDomains) {
    this.storageTiering = new StorageTiering(machines);
    this.serviceMesh = new ServiceMesh(machines, workspaces, undefined, enabled);
    this.vtpmEnrollment = new VtpmEnrollment(machines);
    this.acmeRenewal = new AcmeRenewal(machines, undefined, undefined, {
      allowed: () => dependencies.optional('capabilityChecks')?.acmeAllowed() || false,
      mutation: delta => dependencies.optional('capabilityChecks')?.mutation(delta),
    });
    this.teamTemplates = new TeamTemplates(machines, workspaces);
    this.haFailureMonitor = new HaFailureMonitor(machines, policy);
  }
  async init() {
    try {
      await this.storageTiering.init(); await this.serviceMesh.init(); await this.vtpmEnrollment.init();
      await this.acmeRenewal.init(); await this.haFailureMonitor.init();
    } catch (error) { await this.close().catch(() => {}); throw error; }
  }
  async close() {
    const outcomes = await Promise.allSettled([this.storageTiering.close(), this.serviceMesh.close(), this.vtpmEnrollment.close(),
      this.acmeRenewal.close(), this.haFailureMonitor.close(), this.optional.objectBackup?.close(), this.optional.wireGuardOverlay?.close()]);
    const failures = outcomes.filter(item => item.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(item => item.reason), '平台领域服务清理未完成');
  }
}
