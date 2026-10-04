import { PackageWorkbench } from './package-workbench.ts';
import type { VmAccess } from './vm-access.ts';
import type { HostServiceResolver } from './host-service-contracts.ts';

export class AutomationDomainServices {
  readonly packageWorkbench: PackageWorkbench;
  constructor(machines: VmAccess, task: ConstructorParameters<typeof PackageWorkbench>[1], private dependencies: HostServiceResolver) {
    this.packageWorkbench = new PackageWorkbench(machines, task);
  }
  get processInterop() { return this.dependencies.optional('processInterop'); }
  get mediaDevices() { return this.dependencies.optional('mediaDevices'); }
  get hostMounts() { return this.dependencies.optional('hostMounts'); }
  get projectTerminals() { return this.dependencies.optional('projectTerminals'); }
}
