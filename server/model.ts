// Compatibility facade. New consumers import contracts and host paths directly.
export * from '../shared/contracts/vm.ts';
export { AppError } from '../shared/errors.ts';
export { checkedId, guestPath } from '../shared/paths.ts';
export { ROOT, DATA, VM_ROOT, IMAGE, PORT, vmDir, setVmStorageRoot } from './paths.ts';
export { desktopPreferencesSchema, defaultDesktopPreferences } from '../shared/desktop-preferences.ts';
export type { DesktopPreferences } from '../shared/desktop-preferences.ts';
