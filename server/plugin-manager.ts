import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import {
  PLUGINS,
  PLUGIN_PACKS,
  emptySelection,
  type PluginSelection,
  type PluginStatus,
} from '../shared/plugins.ts';
import { migratePlugins, explainPlugins, resolvePlugins } from '../shared/plugin-selection.ts';
import { PluginDirectory } from './plugin-directory.ts';
import { PluginRuntime } from './plugin-runtime.ts';
import type { Machines } from './machines.ts';
import { SystemServices } from './system-services.ts';

const changeSchema = z
  .object({
    kind: z.enum(['plugin', 'pack']),
    id: z.string(),
    enabled: z.boolean(),
  })
  .strict();

/** The single management entry: persistent intent and live instance authority. */
export class PluginManager {
  readonly directory = new PluginDirectory();
  readonly system = new SystemServices(this.directory);
  private runtime?: PluginRuntime;
  private selection = emptySelection();
  private startupPlanned: string[] = [];
  private migrations: string[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file = join(DATA, 'plugins.json')) {}
  async init() {
    const migrated = migratePlugins(await readStore(this.file, emptySelection));
    this.selection = migrated.selection;
    this.migrations = migrated.migrations;
    this.startupPlanned = resolvePlugins(this.selection);
    return [...this.startupPlanned];
  }
  async start(machines: Machines, rolloutAllowed?: (id: string) => boolean) {
    if (this.runtime) throw new AppError('插件管理层已经启动', 409);
    this.runtime = await PluginRuntime.create(machines, this.startupPlanned, rolloutAllowed, this.directory, this.system);
    return this.runtime;
  }
  async unload(id: string) { await this.runtime?.unload(id); }
  canRetryCleanup(identity: string, generation: string) {
    const instance = this.directory.all().find(item => item.identity === identity && item.generation === generation);
    if (!instance || instance.phase !== 'cleanup-pending' || this.system.caller.phase !== 'running') return false;
    if (instance.source === 'official' || instance === this.directory.get('system', 'terminal-backend')) return !!this.runtime;
    if (instance.source === 'system') return this.system.ownsInstance(instance);
    return this.system.has('communityPlugins');
  }
  /** Recovery only targets the exact failed activation, never the replacement plugin. */
  async retryCleanup(identity: string, generation: string) {
    const instance = this.directory.all().find(item => item.identity === identity && item.generation === generation);
    if (!instance || instance.phase !== 'cleanup-pending')
      throw new AppError('原插件清理实例已变化', 409, 'RECOVERY_STALE');
    if (instance.source === 'official' || instance === this.directory.get('system', 'terminal-backend'))
      await this.runtime?.recoverProvider(instance.identity, instance.generation, instance.artifactDigest);
    else if (instance.source === 'system') {
      const dependent = this.system.lifecycle.view().find(entry =>
        entry.attempted && [...entry.requires, ...entry.disposeRequires].includes(instance.pluginId) &&
        !['registered', 'disposed'].includes(entry.state));
      if (dependent) throw new AppError('请先恢复依赖此服务的消费者：' + dependent.id, 409, 'SERVICE_DEPENDENTS_ACTIVE');
      if (instance === this.system.caller) await this.system.close();
      else await this.system.retire(instance.pluginId);
    } else await this.community.recoverCleanup(instance.pluginId, generation);
    if (this.directory.get(instance.source, instance.pluginId) !== instance || instance.view().phase !== 'inactive')
      throw new AppError('原领域尚未确认清理', 503, 'RECOVERY_CLEANUP_PENDING');
  }
  get community() { return this.system.resolver(this.system.caller, ['communityPlugins']).optional('communityPlugins')!; }
  assertReady() {
    this.system.lifecycle.validateReady();
    for (const plugin of PLUGINS.filter(item => this.runtime?.enabled.has(item.id)))
      for (const dependency of plugin.systemDependencies) if (!this.system.has(dependency))
        throw new AppError(`插件 ${plugin.id} 缺少必需宿主服务：${dependency}`, 503, 'PLUGIN_SERVICE_UNAVAILABLE');
  }
  async close() { await this.runtime?.close(); await this.system.close(); }
  view(): PluginStatus {
    const planned = resolvePlugins(this.selection);
    return {
      selection: structuredClone(this.selection),
      active: this.runtime ? [...this.runtime.enabled] : [],
      planned,
      reasons: explainPlugins(this.selection),
      migrations: [...this.migrations],
      restartRequired:
        planned.length !== this.startupPlanned.length ||
        planned.some((id) => !this.startupPlanned.includes(id)),
      errors: { ...this.runtime?.errors },
      lifecycle: structuredClone(this.runtime?.lifecycle ?? {}),
      runtime: this.directory.view(),
      plugins: PLUGINS,
      packs: PLUGIN_PACKS,
    };
  }
  change(input: unknown) {
    const change = changeSchema.parse(input);
    // Keep old CLI/API calls useful after an aggregate plugin becomes a pack.
    const replacement =
      change.kind === 'plugin' && PLUGIN_PACKS.find((pack) => pack.replacesPlugins.includes(change.id));
    if (replacement) {
      change.kind = 'pack';
      change.id = replacement.id;
    }
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        const catalog = change.kind === 'plugin' ? PLUGINS : PLUGIN_PACKS;
        if (!catalog.some((item) => item.id === change.id)) throw new AppError('插件或整合包不存在', 404);
        const next: PluginSelection = structuredClone(this.selection);
        const key = change.kind === 'plugin' ? 'plugins' : 'packs';
        next[key] = change.enabled
          ? [...new Set([...next[key], change.id])].sort()
          : next[key].filter((id) => id !== change.id);
        const planned = resolvePlugins(next);
        if (!change.enabled && change.kind === 'plugin' && planned.includes(change.id)) {
          const users = [
            ...next.packs
              .filter((id) => resolvePlugins({ ...emptySelection(), packs: [id] }).includes(change.id))
              .map((id) => `整合包 ${id}`),
            ...next.plugins
              .filter((id) => resolvePlugins({ ...emptySelection(), plugins: [id] }).includes(change.id))
              .map((id) => `插件 ${id}`),
          ];
          throw new AppError(`此插件仍被依赖，请先停用：${users.join('、')}`, 409);
        }
        await writeStore(this.file, next);
        this.selection = next;
        this.directory.setDesired('official', planned);
        this.migrations = [];
        return this.view();
      });
    this.queue = operation;
    return operation;
  }
}
