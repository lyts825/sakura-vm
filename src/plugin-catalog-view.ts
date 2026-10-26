/**
 * 模块职责：按使用场景组织运行时插件目录，只影响浏览、筛选与排序。
 * Module purpose: Organize the runtime plugin catalog by user purpose without changing selection or activation.
 */
import type { PluginManifest, PluginPack } from '../shared/plugin-protocol.ts';

export const pluginCatalogGroups = [
  { id: 'core', label: '常用核心', description: '日常使用、项目开发与运维备份。', packs: ['essentials', 'developer', 'operations'] },
  { id: 'components', label: '核心细分', description: '开发工作台和运维包已包含这些组合，也可单独选择。', packs: ['development', 'environment', 'monitoring'] },
  { id: 'runtime', label: '环境与交付', description: '图形桌面、项目交付、环境镜像与应用运行。', packs: ['desktop', 'delivery', 'foundry', 'app-runtime'] },
  { id: 'engineering', label: '工程验证', description: '接口、浏览器、数据库、可靠性与软件供应检查。', packs: ['integration-lab', 'browser-lab', 'database-evolution', 'event-lab', 'resilience-lab', 'supply-audit', 'incident-desk', 'dependency-resolution-studio'] },
  { id: 'data', label: '数据与建模', description: '数据处理、实验规划、特征、训练与模型评测。', packs: ['data-lab', 'data-quality-studio', 'lineage-atlas', 'entity-resolution-studio', 'temporal-data-studio', 'geospatial-studio', 'graph-insight-studio', 'experiment-planner', 'feature-engineering-studio', 'classical-training-lab', 'constraint-solver-studio', 'model-evaluation'] },
  { id: 'content', label: '内容与设计', description: '知识文档、设计系统、表单、通知与媒体制作。', packs: ['knowledge-studio', 'document-extraction-studio', 'design-system-studio', 'form-flow-studio', 'notification-template-studio', 'media-studio', 'localization-studio', 'learning-lab'] },
  { id: 'advanced', label: '流程与扩展实验', description: '跨包流程、扩展开发与调度、协议、副本实验。', packs: ['flow-studio', 'schedule-semantics-lab', 'extension-authoring-studio', 'protocol-state-lab', 'replica-sync-lab', 'service-virtualization-studio'] },
  { id: 'compatibility', label: '实验与兼容', description: '通用实验能力和完整兼容选择，按需要展开。', packs: ['lab', 'complete'] },
  { id: 'other', label: '其他用途', description: '当前目录中尚未归类的整合包与插件。', packs: [] },
] as const;

export type PluginCatalogGroup = (typeof pluginCatalogGroups)[number]['id'];

/** 中文：返回包的用途分类，未知包继续保留在其他用途。 English: Classify a pack while keeping unknown packs discoverable. */
export function packCatalogGroup(id: string): PluginCatalogGroup {
  return pluginCatalogGroups.find(group => (group.packs as readonly string[]).includes(id))?.id || 'other';
}

/** 中文：仅从包的直接插件成员推导用途，完整兼容包和依赖展开不参与归类。 English: Classify direct members without importing complete-pack membership or dependency closures. */
export function pluginCatalogPurposes(plugins: readonly PluginManifest[], packs: readonly PluginPack[]) {
  const purposes = new Map<string, Set<PluginCatalogGroup>>();
  for (const pack of packs) {
    if (pack.id === 'complete') continue;
    const group = packCatalogGroup(pack.id);
    for (const member of pack.members) {
      if (member.kind !== 'plugin') continue;
      const groups = purposes.get(member.id) || new Set<PluginCatalogGroup>();
      groups.add(group);
      purposes.set(member.id, groups);
    }
  }
  const fallback: Record<PluginManifest['category'], PluginCatalogGroup> = {
    foundation: 'core', workspace: 'core', development: 'engineering', operations: 'core', experimental: 'compatibility',
  };
  for (const plugin of plugins) {
    if (plugin.id === 'repair') purposes.set(plugin.id, new Set(['advanced']));
    if (!purposes.has(plugin.id)) purposes.set(plugin.id, new Set([fallback[plugin.category] || 'other']));
  }
  return purposes;
}

/** 中文：按用途及常用包顺序排列，未知包使用名称保持稳定顺序。 English: Order by purpose and curated pack order, retaining stable names for unknown entries. */
export function compareCatalogPacks(left: PluginPack, right: PluginPack) {
  const order: readonly string[] = pluginCatalogGroups.flatMap(group => [...group.packs]);
  const rank = (id: string) => order.indexOf(id) < 0 ? order.length : order.indexOf(id);
  return rank(left.id) - rank(right.id) || left.name.localeCompare(right.name, 'zh-CN');
}
