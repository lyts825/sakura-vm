/**
 * 模块职责（中文）：恢复浏览器保存的实例、页面和标签选择；页面/标签必须属于内置或插件声明的导航集合。
 * Module responsibility (English): Restoring and validating navigation selections persisted in browser storage.
 * 详细范围（中文）：公开入口包括 readSessionState；职责覆盖恢复并校验浏览器保存的导航选择，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include readSessionState. The scope covers Restoring and validating navigation selections persisted in browser storage. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { PLUGINS } from '../plugin-surfaces.ts';

type SessionState = { selected: string; page: string; tab: string };
const sessionPages = new Set([
  'workspace',
  'plugins',
  'tasks',
  'library',
  'images',
  'features',
  'settings',
  ...PLUGINS.flatMap((plugin) => plugin.contributes.pages),
]);
const sessionTabs = new Set([
  'terminal',
  'desktop',
  'files',
  'project',
  'git',
  'development',
  'containers',
  'metrics',
  'services',
  'sync',
  'snapshots',
  'maintenance',
  'config',
  ...PLUGINS.flatMap((plugin) => plugin.contributes.tabs),
]);
/**
 * 中文：从浏览器会话存储恢复实例、页面、分区和终端导航，校验允许值与 UUID；损坏或不可用存储回退默认导航。
 * English: Restore VM/page/section/terminal navigation from browser session storage, validating allowed values and UUIDs. Damaged/unavailable storage falls back to default navigation.
 * 中文：结果：包含 selected、page、tab 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing selected, page, tab for caller state reads/operations
 */
export function readSessionState(): SessionState {
  try {
    const saved = JSON.parse(localStorage.getItem('sakura-session') || '{}') as Partial<SessionState>;
    return {
      selected: typeof saved.selected === 'string' ? saved.selected : '',
      page: typeof saved.page === 'string' && sessionPages.has(saved.page) ? saved.page : 'workspace',
      tab: typeof saved.tab === 'string' && sessionTabs.has(saved.tab) ? saved.tab : 'terminal',
    };
  } catch {
    return { selected: '', page: 'workspace', tab: 'terminal' };
  }
}
