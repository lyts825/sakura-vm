/**
 * 模块职责：描述单次虚拟机运行的内部状态，集中保存启动、连接、取消及退出等待资源。
 */
import type { Socket } from 'node:net';
import type { Client } from 'ssh2';
import type { VMStatus } from '../shared/contracts/vm.ts';
import type { VmNetworkLease } from './network/index.ts';
import type { VmLifetime } from './vm-lifetime.ts';

export type Live = {
  lifetime?: VmLifetime;
  status: VMStatus;
  incoming?: boolean;
  accelerator: 'tcg' | 'whpx';
  startedAt: string;
  sshPort: number;
  qmpPort: number;
  agentPort: number;
  serialPort: number;
  network?: VmNetworkLease;
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
