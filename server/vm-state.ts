import type { Socket } from 'node:net';
import type { Client } from 'ssh2';
import type { VMStatus } from '../shared/contracts/vm.ts';

export type Live = {
  status: VMStatus;
  incoming?: boolean;
  accelerator: 'tcg' | 'whpx';
  startedAt: string;
  sshPort: number;
  qmpPort: number;
  agentPort: number;
  serialPort: number;
  abort: AbortController;
  bootAbort: AbortController;
  bootstrapKnown?: boolean;
  serialConnected?: boolean;
  serialReady?: boolean;
  serialTail?: string;
  done: Promise<void>;
  bootDone?: Promise<void>;
  allowInitialReset?: boolean;
  serial?: Socket;
  clients: Set<Client>;
  memoryTargetMiB?: number;
  error?: string;
};
