/** 协议与多服务分别公开模型计算和固定客户机会话，计算不能选择执行器。 */
import { SuiteExecutionSessions } from './suite-execution-sessions.ts';
import { SeventhComputePort } from './seventh-compute.ts';
import type { SeventhComputePortV1 } from '../shared/contracts/seventh-common.ts';
class CombinedSessions extends SuiteExecutionSessions {
  constructor(
    private kernel: SeventhComputePort,
    ...args: ConstructorParameters<typeof SuiteExecutionSessions>
  ) {
    super(...args);
  }
  execute(...args: Parameters<SeventhComputePortV1['execute']>) {
    return this.kernel.execute(...args);
  }
  actions() {
    return this.kernel.actions();
  }
  toolIdentity(...args: Parameters<SeventhComputePortV1['toolIdentity']>) {
    return this.kernel.toolIdentity(...args);
  }
  prepareNative(...args: Parameters<SeventhComputePortV1['prepareNative']>) {
    return this.kernel.prepareNative(...args);
  }
  acknowledgeNative(...args: Parameters<SeventhComputePortV1['acknowledgeNative']>) {
    return this.kernel.acknowledgeNative(...args);
  }
  reconcileNative(...args: Parameters<SeventhComputePortV1['reconcileNative']>) {
    return this.kernel.reconcileNative(...args);
  }
  lifecycle(action: string) {
    return this.kernel.lifecycle(action);
  }
}
export class SeventhProtocolSessions extends CombinedSessions {
  constructor(...args: ConstructorParameters<typeof SuiteExecutionSessions>) {
    super(new SeventhComputePort('protocol-state-lab', 'core:protocolScenarioSessions'), ...args);
  }
}
export class SeventhVirtualizationSessions extends CombinedSessions {
  constructor(...args: ConstructorParameters<typeof SuiteExecutionSessions>) {
    super(
      new SeventhComputePort('service-virtualization-studio', 'core:multiServiceVirtualizationSessions'),
      ...args,
    );
  }
}
