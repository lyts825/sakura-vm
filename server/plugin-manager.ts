import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import {
  PLUGINS,
  PLUGIN_PACKS,
  emptySelection,
  type PluginSelection,
  type PluginStatus,
} from '../shared/plugins.ts';
import { migratePlugins, explainPlugins, resolvePlugins } from '../shared/plugin-selection.ts';

const changeSchema = z
  .object({
    kind: z.enum(['plugin', 'pack']),
    id: z.string(),
    enabled: z.boolean(),
  })
  .strict();

/** Persist intent only. Activation changes at the next process start, never under a live VM job. */
export class PluginManager {
  private selection = emptySelection();
  private active: string[] = [];
  private errors: Record<string, string> = {};
  private lifecycle: PluginStatus['lifecycle'] = {};
  private migrations: string[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file = join(DATA, 'plugins.json')) {}
  async init() {
    const migrated = migratePlugins(await readStore(this.file, emptySelection));
    this.selection = migrated.selection;
    this.migrations = migrated.migrations;
    return resolvePlugins(this.selection);
  }
  activated(active: Iterable<string>, errors: Record<string, string> = {}, lifecycle: PluginStatus['lifecycle'] = {}) {
    this.active = [...active];
    this.errors = { ...errors };
    this.lifecycle = { ...lifecycle };
  }
  view(): PluginStatus {
    const planned = resolvePlugins(this.selection);
    return {
      selection: structuredClone(this.selection),
      active: [...this.active],
      planned,
      reasons: explainPlugins(this.selection),
      migrations: [...this.migrations],
      restartRequired:
        planned.length !== this.active.length || planned.some((id) => !this.active.includes(id)),
      errors: { ...this.errors },
      lifecycle: structuredClone(this.lifecycle),
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
        this.migrations = [];
        return this.view();
      });
    this.queue = operation;
    return operation;
  }
}
