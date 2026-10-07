/**
 * 模块职责：记录单个插件实例的权限及受管贡献，撤销后拒绝继续使用原能力。
 */
import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import type {
  PluginInstanceView,
  PluginSource,
  PluginContributionKind,
} from '../shared/contracts/plugin-runtime.ts';
import { withResourceContext } from './host-runtime/context.ts';
import { PluginScope } from './plugin-scope.ts';

/** An activation is immutable. Revocation never transfers authority to its successor. */
export class PluginInstance {
  readonly generation: string;
  readonly identity: string;
  readonly scope: PluginScope;
  phase: PluginInstanceView['phase'] = 'activating';
  desired = true;
  activationMs = 0;
  error?: string;
  private permissions: Set<string>;
  private contributions = new Map<string, { kind: PluginContributionKind; id: string; target: string }>();
  private managedKinds?: ReadonlySet<string>;
  declareManaged(kinds: readonly string[]) {
    this.managedKinds = new Set(kinds);
  }
  contribute(kind: PluginContributionKind, target: string) {
    this.check(undefined, true);
    if (
      ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'].includes(kind) &&
      this.managedKinds &&
      !this.managedKinds.has(kind)
    )
      throw new AppError('插件未声明受管贡献：' + kind, 403, 'PLUGIN_CONTRIBUTION_DENIED');
    const id = randomUUID();
    this.contributions.set(id, { kind, id, target });
    if (this.phase === 'running') this.changed();
    const remove = () => {
      if (this.contributions.delete(id) && this.phase === 'running') this.changed();
    };
    this.scope.add(remove);
    return remove;
  }
  constructor(
    readonly source: PluginSource,
    readonly pluginId: string,
    readonly version: string,
    readonly artifactDigest: string,
    permissions: readonly string[] = [
      'vm',
      'execution',
      'network',
      'process',
      'storage',
      'metadata',
      'compute',
      'jobs',
      'schedule',
      'events',
      'services',
    ],
    generation: string = randomUUID(),
    private readonly changed: () => void = () => {},
  ) {
    this.generation = generation;
    this.identity = `${source}:${pluginId}`;
    this.permissions = new Set(permissions);
    this.scope = withResourceContext(this.resourceIdentity, () => new PluginScope(this.owner));
  }
  get owner() {
    return this.source === 'official' ? `plugin:${this.pluginId}` : `${this.source}:${this.pluginId}`;
  }
  get signal() {
    return this.scope.signal;
  }
  get resourceIdentity() {
    return {
      owner: this.owner,
      pluginId: this.pluginId,
      pluginInstanceId: this.identity,
      pluginGeneration: this.generation,
    };
  }
  check(permission?: string, activating = false) {
    if (this.signal.aborted || !(this.phase === 'running' || (activating && this.phase === 'activating')))
      throw new AppError(`插件实例已撤销：${this.identity}`, 403, 'PLUGIN_REVOKED');
    if (permission && !this.permissions.has(permission))
      throw new AppError(`插件缺少权限：${permission}`, 403, 'PLUGIN_PERMISSION_DENIED');
  }
  revoke(reason: unknown = new DOMException('插件实例已撤销', 'AbortError')) {
    this.phase = 'draining';
    this.scope.abort(reason);
  }
  setPermissions(permissions: readonly string[]) {
    this.permissions = new Set(permissions);
    this.changed();
  }
  view(): PluginInstanceView {
    return {
      identity: this.identity,
      source: this.source,
      pluginId: this.pluginId,
      version: this.version,
      artifactDigest: this.artifactDigest,
      generation: this.generation,
      permissions: [...this.permissions].sort(),
      desired: this.desired,
      phase: this.phase,
      activationMs: this.activationMs,
      error: this.error,
      resourceId: this.scope.diagnostics().resourceId,
      contributions: [...this.contributions.values()],
    };
  }
}
