import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from '../shared/errors.ts';
import { ResourceScope } from './resource-scope.ts';
import type { Live } from './vm-state.ts';
import type { VmNetworkLease } from './network/index.ts';
import type { VMRecord } from '../shared/contracts/vm.ts';
import type { BootAttachment } from './machines.ts';

export type VmBootProvider = {
  prepare(vm: VMRecord, onExit: (error: string) => void): Promise<BootAttachment | undefined>;
  firmware?(vm: VMRecord): Promise<{ code: string; vars: string } | undefined>;
  allowInitialReset?: boolean;
};
const bootProviders = new WeakMap<object, Map<string, VmBootProvider>>();
export function registerVmBootProvider(owner: object, name: string, provider: VmBootProvider) {
  let providers = bootProviders.get(owner);
  if (!providers) bootProviders.set(owner, (providers = new Map()));
  if (providers.has(name)) throw new Error(`VM boot provider already registered: ${name}`);
  providers.set(name, provider);
  return () => {
    if (providers.get(name) === provider) providers.delete(name);
  };
}
export function vmBootProviders(owner: object): ReadonlyArray<readonly [string, VmBootProvider]> {
  return [...(bootProviders.get(owner) || [])];
}

export type VmIdentity = Readonly<{
  vmId: string;
  vmProcessId: string;
  executionGeneration: string;
  bootId?: string;
  networkGeneration?: string;
}>;
type Activity = { abort: AbortController; done: Promise<void>; failure?: unknown; release(): void };
const legacy = new WeakMap<object, VmLifetime>();
const exclusiveContext = new AsyncLocalStorage<{ lifetime: VmLifetime; active: boolean }>();
const changed = () => new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');

/** Process lifetime, restored RAM generation and observed guest boot are independent identities. */
export class VmLifetime {
  readonly vmProcessId = randomUUID();
  readonly resources: ResourceScope;
  private generation = randomUUID();
  private execution = new AbortController();
  private observedBoot?: string;
  private bootGeneration?: string;
  private network?: VmNetworkLease;
  private activities = new Set<Activity>();
  private barriers = 0;
  private ended = false;
  private ownsNetwork = false;
  constructor(
    readonly vmId: string,
    readonly abort = new AbortController(),
  ) {
    this.resources = new ResourceScope({ owner: `vm:${vmId}`, signal: abort.signal });
    abort.signal.addEventListener(
      'abort',
      () => {
        this.ended = true;
        this.execution.abort(abort.signal.reason);
        for (const activity of this.activities) activity.abort.abort(abort.signal.reason);
      },
      { once: true },
    );
  }
  get signal() {
    return this.execution.signal;
  }
  get lastObservedBootId() {
    return this.observedBoot;
  }
  get active() {
    return this.activities.size;
  }
  get admitting() {
    return !this.ended && !this.abort.signal.aborted && this.barriers === 0;
  }
  capture(): VmIdentity {
    return Object.freeze({
      vmId: this.vmId,
      vmProcessId: this.vmProcessId,
      executionGeneration: this.generation,
      ...(this.observedBoot && this.bootGeneration === this.generation ? { bootId: this.observedBoot } : {}),
      ...(this.network ? { networkGeneration: this.network.generation } : {}),
    });
  }
  assert(identity: VmIdentity) {
    if (
      this.ended ||
      this.abort.signal.aborted ||
      identity.vmId !== this.vmId ||
      identity.vmProcessId !== this.vmProcessId ||
      identity.executionGeneration !== this.generation ||
      (identity.bootId !== undefined && identity.bootId !== this.observedBoot) ||
      (identity.networkGeneration !== undefined && identity.networkGeneration !== this.network?.generation)
    )
      throw changed();
  }
  observeBoot(bootId: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(bootId))
      throw new Error('Invalid observed guest boot identity');
    if (this.bootGeneration === this.generation && this.observedBoot && this.observedBoot !== bootId)
      this.advanceExecution();
    this.observedBoot = bootId;
    this.bootGeneration = this.generation;
  }
  advanceExecution() {
    if (this.ended || this.abort.signal.aborted) throw changed();
    this.execution.abort(changed());
    this.execution = new AbortController();
    this.generation = randomUUID();
    // Keep the last real observation, but do not stamp an unobserved restored generation with it.
    // RAM restore may return to an older boot_id; the first actual guest read pins that value.
    return this.capture();
  }
  async setNetwork(lease: VmNetworkLease) {
    if (lease.vmId !== this.vmId || this.ended || this.abort.signal.aborted) {
      await lease.close();
      throw changed();
    }
    this.network = lease;
    if (!this.ownsNetwork) {
      this.resources.defer('network', () => this.network?.close(), 20);
      this.ownsNetwork = true;
    }
  }
  async own<T extends { close(): unknown }>(name: string, resource: T, order = 0): Promise<T> {
    if (this.ended || this.abort.signal.aborted) {
      await resource.close();
      throw changed();
    }
    try {
      return this.resources.own(name, resource, order);
    } catch (error) {
      await resource.close();
      throw error;
    }
  }
  enter(identity = this.capture()) {
    this.assert(identity);
    const exclusive = exclusiveContext.getStore();
    if (!this.admitting && !(exclusive?.lifetime === this && exclusive.active))
      throw new AppError('实例正在切换状态，暂不接收项目执行', 409, 'VM_EXECUTION_DRAINING');
    const abort = new AbortController();
    let finish!: () => void;
    const activity: Activity = {
      abort,
      done: new Promise((resolve) => {
        finish = resolve;
      }),
      release: () => {
        if (this.activities.delete(activity)) finish();
      },
    };
    this.activities.add(activity);
    return {
      signal: AbortSignal.any([abort.signal, this.signal, this.abort.signal]),
      release: activity.release,
      cleanupPending: (error: unknown) => {
        activity.failure = error;
        finish();
      },
    };
  }
  /** Synchronous exclusion prevents an execution admission racing an already-held VM lock. */
  async exclusive<T>(work: () => Promise<T>, allowFailed = false): Promise<T> {
    if ([...this.activities].some((activity) => !allowFailed || activity.failure === undefined))
      throw new AppError('该实例的另一项操作正在进行', 409, 'VM_EXECUTION_ACTIVE');
    this.barriers++;
    const context = { lifetime: this, active: true };
    try {
      return await exclusiveContext.run(context, work);
    } finally {
      context.active = false;
      this.barriers--;
    }
  }
  /** Close admission before waiting; callers acquire the exclusive VM lock only after this resolves. */
  async barrier<T>(work: () => Promise<T>, cancel = true, allowFailed = false): Promise<T> {
    if (this.ended || this.abort.signal.aborted) throw changed();
    this.barriers++;
    try {
      const active = [...this.activities];
      if (cancel)
        for (const activity of active) activity.abort.abort(new AppError('实例状态切换已取消当前执行', 409));
      await Promise.all(active.map((activity) => activity.done));
      if (!allowFailed && active.some((activity) => activity.failure !== undefined))
        throw new AppError('项目执行清理尚未确认，无法切换实例状态', 503, 'EXECUTION_CLEANUP_PENDING');
      if (this.ended || this.abort.signal.aborted) throw changed();
      return await work();
    } finally {
      this.barriers--;
    }
  }
  end(reason?: unknown) {
    this.abort.abort(reason);
  }
  close() {
    this.end();
    return this.resources.retryCleanup();
  }
}

/** Legacy in-process fixtures receive the same checks; absence never bypasses identity capture. */
export function vmLifetime(vmId: string, live: Live): VmLifetime {
  const current = live.lifetime || legacy.get(live);
  if (current) {
    if (current.vmId !== vmId) throw changed();
    return current;
  }
  const lifetime = new VmLifetime(vmId, live.abort);
  legacy.set(live, lifetime);
  live.lifetime = lifetime;
  return lifetime;
}
