import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import type { PluginInstanceView, PluginSource } from '../shared/contracts/plugin-runtime.ts';
import { withResourceContext } from './host-runtime/context.ts';
import { PluginScope } from './plugin-scope.ts';

/** An activation is immutable. Revocation never transfers authority to its successor. */
export class PluginInstance {
  readonly generation = randomUUID();
  readonly identity: string;
  readonly scope: PluginScope;
  phase: PluginInstanceView['phase'] = 'activating';
  desired = true;
  activationMs = 0;
  error?: string;
  private permissions: Set<string>;
  constructor(readonly source: PluginSource, readonly pluginId: string,
    readonly version: string, readonly artifactDigest: string, permissions: readonly string[] = ['vm', 'execution', 'network', 'process', 'storage', 'metadata', 'compute', 'jobs', 'schedule', 'events']) {
    this.identity = `${source}:${pluginId}`;
    this.permissions = new Set(permissions);
    this.scope = withResourceContext(this.resourceIdentity, () => new PluginScope(this.owner));
  }
  get owner() { return this.source === 'official' ? `plugin:${this.pluginId}` : `${this.source}:${this.pluginId}`; }
  get signal() { return this.scope.signal; }
  get resourceIdentity() { return { owner: this.owner, pluginId: this.pluginId,
    pluginInstanceId: this.identity, pluginGeneration: this.generation }; }
  check(permission?: string, activating = false) {
    if (this.signal.aborted || !(this.phase === 'running' || activating && this.phase === 'activating'))
      throw new AppError(`插件实例已撤销：${this.identity}`, 403, 'PLUGIN_REVOKED');
    if (permission && !this.permissions.has(permission))
      throw new AppError(`插件缺少权限：${permission}`, 403, 'PLUGIN_PERMISSION_DENIED');
  }
  revoke(reason: unknown = new DOMException('插件实例已撤销', 'AbortError')) {
    this.phase = 'draining';
    this.scope.abort(reason);
  }
  setPermissions(permissions: readonly string[]) { this.permissions = new Set(permissions); }
  view(): PluginInstanceView {
    return { identity: this.identity, source: this.source, pluginId: this.pluginId,
      version: this.version, artifactDigest: this.artifactDigest, generation: this.generation,
      permissions: [...this.permissions].sort(), desired: this.desired, phase: this.phase,
      activationMs: this.activationMs, error: this.error, resourceId: this.scope.diagnostics().resourceId };
  }
}
