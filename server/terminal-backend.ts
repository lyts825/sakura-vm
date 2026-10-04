import type { ServiceInterface } from './service-interface.ts';
import type { Machines } from './machines.ts';
import { ProjectTerminals } from './project-terminals.ts';
import type { PreparedProject } from './project-preparation.ts';
import { Workspaces } from './workspaces.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { pluginAuthority, withPluginAuthority, withPluginCleanup } from './plugin-authority.ts';
import { vmAccess } from './vm-access.ts';
import { vmHostIdentity } from './vm-reference.ts';
import { ExecutionScope } from './execution-scope.ts';
import { resourceContext, withResourceContext } from './host-runtime/context.ts';
import { AppError } from '../shared/errors.ts';
import { cleanupReceipt } from './cleanup-receipt.ts';
import type { ServiceBroker } from './service-broker.ts';

export type TerminalService = Pick<ProjectTerminals, keyof ProjectTerminals>;
const backends = new WeakMap<object, TerminalBackend>();

/** One provider owns native sessions; each consumer owns only its connection leases. */
export class TerminalBackend {
  private root: ProjectTerminals;
  constructor(machines: Machines, readonly instance: PluginInstance,
    context?: ConstructorParameters<typeof Workspaces>[1], private broker?: ServiceBroker, private host?: PluginInstance) {
    const port = vmAccess(machines, instance.scope, instance, (vmId, signal, work) =>
      ExecutionScope.run({ machines, vmId, projectId: resourceContext()?.projectId || 'default',
        signal, owner: ExecutionScope.current()?.owner || instance.owner, delegate: true }, work));
    const workspace = withPluginAuthority(instance, () => new Workspaces(port, context, { background: false }));
    this.root = withPluginAuthority(instance, () => new ProjectTerminals(port, workspace));
    instance.scope.add(() => workspace.close());
    broker?.registerSystem(instance, this.root);
    backends.set(machines, this);
    instance.scope.add(() => withPluginCleanup(instance, () => this.root.close()));
  }
  handle(consumer = pluginAuthority()): TerminalService {
    const leases = new Set<PreparedProject>();
    const lifetime = new AbortController();
    const signal = consumer ? AbortSignal.any([consumer.signal, lifetime.signal]) : lifetime.signal;
    const check = () => { signal.throwIfAborted(); consumer?.check('execution', true); this.instance.check(undefined, true); };
    const invoke = <T>(work: () => T): T => {
      check(); return withPluginAuthority(this.instance, () => withResourceContext({
        callerPluginInstanceId: consumer?.identity, callerPluginGeneration: consumer?.generation,
      }, work), check);
    };
    const retain = async (pending: Promise<PreparedProject>) => {
      consumer?.scope.observe(pending); this.instance.scope.observe(pending);
      const prepared = await pending;
      let closed = false;
      const release = cleanupReceipt(async () => {
        if (closed) return;
        await withPluginCleanup(this.instance, () => prepared.release());
        closed = true; leases.delete(result);
      });
      const result = Object.freeze({ ...prepared, release }); leases.add(result);
      if (signal.aborted) { await release(); signal.throwIfAborted(); }
      return result;
    };
    const close = async () => { lifetime.abort(); await Promise.all([...leases].map(lease => lease.release())); };
    if (consumer) consumer.scope.add(close);
    const root = this.root;
    const publicRoot = this.broker ? this.broker.system<TerminalService>(consumer || this.host!, 'terminal-backend', ['terminal-backend'])! : root;
    return Object.freeze({
      get workspaces() { check(); return publicRoot.workspaces; },
      get preparation() { check(); return publicRoot.preparation; },
      prepare: (...args: Parameters<ProjectTerminals['prepare']>) => invoke(() => {
        args[4] = args[4] ? AbortSignal.any([signal, args[4]]) : signal; return retain(root.prepare(...args));
      }),
      prepareTask: (...args: Parameters<ProjectTerminals['prepareTask']>) => invoke(() => {
        args[2] = args[2] ? AbortSignal.any([signal, args[2]]) : signal; return retain(root.prepareTask(...args));
      }),
      validate: (...args: Parameters<ProjectTerminals['validate']>) => invoke(() => root.validate(...args)),
      stop: (...args: Parameters<ProjectTerminals['stop']>) => invoke(() => {
        if (consumer && consumer.pluginId !== 'terminal-workspace')
          throw new AppError('终端子句柄只能释放自己持有的连接', 403, 'PLUGIN_TERMINAL_OWNERSHIP');
        args[3] = args[3] ? AbortSignal.any([signal, args[3]]) : signal; return root.stop(...args);
      }), close,
    });
  }
}

export function projectTerminalsFor(machines: ConstructorParameters<typeof ProjectTerminals>[0],
  workspaces?: ServiceInterface<Workspaces>, context?: ConstructorParameters<typeof Workspaces>[1],
  options?: ConstructorParameters<typeof ProjectTerminals>[3]): TerminalService {
  const backend = backends.get(vmHostIdentity(machines));
  if (backend) return backend.handle();
  if (pluginAuthority()) throw new AppError('插件终端提供者尚未运行', 503, 'PLUGIN_SERVICE_UNAVAILABLE');
  return new ProjectTerminals(machines, workspaces, context, options);
}
