import { dependencyEndpoint } from './dependency-downloads.ts';

export const repositoryUrl = dependencyEndpoint.refine(value => {
  // Inspect the original path too: URL() normalizes dot segments before validation.
  try {
    const path = /^https?:\/\/[^/]+(\/[^?#]*)?/.exec(value)?.[1] || '/';
    const decoded = decodeURIComponent(path);
    return !decoded.includes('//') && !decoded.split('/').some(part => part === '.' || part === '..');
  } catch { return false; }
}, '仓库路径不能包含点路径或重复分隔符');

export function repositoryAuthorizationScope(repository: string, endpoint: string) {
  const target = new URL(repositoryUrl.parse(repository)), scope = new URL(repositoryUrl.parse(endpoint));
  const path = scope.pathname.replace(/\/$/, '');
  return target.origin === scope.origin && (target.pathname === path || target.pathname.startsWith(path + '/'));
}
