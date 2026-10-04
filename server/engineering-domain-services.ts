import type { ServiceInterface } from './service-interface.ts';
import { ReverseTunnels } from './reverse-tunnels.ts';
import type { VmAccess } from './vm-access.ts';
import type { Workspaces } from './workspaces.ts';
import type { HostServiceResolver } from './host-service-contracts.ts';

export class EngineeringDomainServices {
  readonly tunnels: ReverseTunnels;
  constructor(machines: VmAccess, workspaces: ServiceInterface<Workspaces>, private dependencies: HostServiceResolver) {
    this.tunnels = new ReverseTunnels(machines, workspaces);
  }
  get trustedBoot() { return this.dependencies.optional('trustedBoot'); }
  get projectTerminals() { return this.dependencies.optional('projectTerminals'); }
  close() { return this.tunnels.close(); }
}
