/**
 * 模块职责：恢复浏览器保存的实例、页面和标签选择；页面/标签必须属于内置或插件声明的导航集合。
 */
import { PLUGINS } from '../../shared/plugins';

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
