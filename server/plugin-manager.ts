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
  private runtime?: PluginRuntime;
  private selection = emptySelection();
  private active: string[] = [];
  private startupPlanned: string[] = [];
  private errors: Record<string, string> = {};
  private lifecycle: PluginStatus['lifecycle'] = {};
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
  activated(active: Iterable<string>, errors: Record<string, string> = {}, lifecycle: PluginStatus['lifecycle'] = {}) {
    this.active = [...active];
    this.errors = { ...errors };
    this.lifecycle = { ...lifecycle };
  }
  async start(machines: Machines, rolloutAllowed?: (id: string) => boolean) {
    if (this.runtime) throw new AppError('插件管理层已经启动', 409);
    this.runtime = await PluginRuntime.create(machines, this.startupPlanned, rolloutAllowed, this.directory);
    return this.runtime;
  }
  async unload(id: string) { await this.runtime?.unload(id); }
  async close() { await this.runtime?.close(); }
  view(): PluginStatus {
    const planned = resolvePlugins(this.selection);
    return {
      selection: structuredClone(this.selection),
      active: this.runtime ? [...this.runtime.enabled] : [...this.active],
      planned,
      reasons: explainPlugins(this.selection),
      migrations: [...this.migrations],
      restartRequired:
        planned.length !== this.startupPlanned.length ||
        planned.some((id) => !this.startupPlanned.includes(id)),
      errors: { ...(this.runtime?.errors ?? this.errors) },
      lifecycle: structuredClone(this.runtime?.lifecycle ?? this.lifecycle),
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
