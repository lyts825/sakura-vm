import { AppError } from '../../shared/errors.ts';
import { peerReplicaActivationInput, peerActivationResult, peerActivationCheckResult, peerRetirementResult } from '../../shared/contracts/peer-transfer.ts';

export type PeerReplicaPorts = {
  requireAvailable(): void;
  request(peerId: string, path: string, input: unknown, timeoutMs?: number): Promise<unknown>;
};

/** Replica receipts remain domain authority; transport only carries validated requests and replies. */
export class PeerReplicaOperations {
  constructor(private readonly ports: PeerReplicaPorts) {}
  async check(peerId: string, input: unknown) {
    this.ports.requireAvailable();
    const value = peerReplicaActivationInput.parse(input);
    const result = peerActivationCheckResult.parse(await this.ports.request(peerId, '/peer/replica-activate-check', value));
    if (result.id !== value.remoteVmId) throw new AppError('远端故障副本身份已变化', 409);
    return result;
  }
  async activate(peerId: string, input: unknown) {
    this.ports.requireAvailable();
    const value = peerReplicaActivationInput.parse(input);
    const result = peerActivationResult.parse(await this.ports.request(peerId, '/peer/replica-activate', value, 30_000));
    if (result.id !== value.remoteVmId) throw new AppError('远端故障副本身份已变化', 409);
    return result;
  }
  async retire(peerId: string, input: unknown) {
    this.ports.requireAvailable();
    const value = peerReplicaActivationInput.parse(input);
    const result = peerRetirementResult.parse(await this.ports.request(peerId, '/peer/replica-retire', value, 30_000));
    if (result.id !== value.remoteVmId) throw new AppError('远端故障副本身份已变化', 409);
    return result;
  }
}
