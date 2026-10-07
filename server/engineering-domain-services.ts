/**
 * 模块职责：创建工程领域的临时隧道服务，通过解析器读取可选可信启动和项目终端服务。
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { ReverseTunnels } from './reverse-tunnels.ts';
import type { VmAccess } from './vm-access.ts';

import type { HostServiceResolver } from './host-service-contracts.ts';

export class EngineeringDomainServices {
  readonly tunnels: ReverseTunnels;
  constructor(machines: VmAccess, workspaces: WorkspacesV1, private dependencies: HostServiceResolver) {
    this.tunnels = new ReverseTunnels(machines, workspaces);
  }
  get trustedBoot() { return this.dependencies.optional('trustedBoot'); }
  get projectTerminals() { return this.dependencies.optional('projectTerminals'); }
  close() { return this.tunnels.close(); }
}
