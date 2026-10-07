/**
 * 模块职责：保留旧服务端模型导出入口，实际模型、错误及路径契约来自各自权威模块。
 */
// Compatibility facade. New consumers import contracts and host paths directly.
export * from '../shared/contracts/vm.ts';
export { AppError } from '../shared/errors.ts';
export { checkedId, guestPath } from '../shared/paths.ts';
export { ROOT, DATA, VM_ROOT, IMAGE, PORT, vmDir, setVmStorageRoot } from './paths.ts';
export { desktopPreferencesSchema, defaultDesktopPreferences } from '../shared/desktop-preferences.ts';
export type { DesktopPreferences } from '../shared/desktop-preferences.ts';
