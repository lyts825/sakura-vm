import { z } from 'zod';

export const syncPattern = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (value) => !/[\\\x00-\x1f]/.test(value) && !value.split('/').includes('..') && !value.startsWith('/'),
    '规则需要相对路径，使用 / 分隔',
  );
export const syncPolicySchema = z
  .object({
    pattern: syncPattern,
    direction: z.enum(['both', 'push', 'pull', 'readonly']),
    guestMode: z
      .string()
      .regex(/^[0-7]{3}$/, 'Linux 权限使用三位八进制，例如 644')
      .optional(),
  })
  .strict();
export type SyncPolicy = z.infer<typeof syncPolicySchema>;

export function matchesSyncPattern(path: string, patterns: string[] = []) {
  return patterns.some((pattern) => {
    const value = pattern.replace(/\/$/, '');
    const regex = value
      .split('**')
      .map((part) =>
        part
          .split('*')
          .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*'),
      )
      .join('.*');
    return new RegExp(`${value.includes('/') ? '^' : '(^|/)'}${regex}($|/)`).test(path);
  });
}

export function pathPolicy(path: string, policies: SyncPolicy[] = []) {
  return policies.find((policy) => matchesSyncPattern(path, [policy.pattern]));
}

export function policyAllows(path: string, action: string, policies: SyncPolicy[] = []) {
  const direction = pathPolicy(path, policies)?.direction || 'both';
  if (action === 'skip' || action === 'same') return true;
  if (direction === 'readonly') return false;
  if (direction === 'both') return true;
  return (
    direction === 'push'
      ? ['push', 'mkdir-guest', 'delete-guest', 'rename-guest']
      : ['pull', 'mkdir-host', 'delete-host', 'rename-host']
  ).includes(action);
}

export type SyncRename = { from: string; path: string; action: 'rename-host' | 'rename-guest'; sha: string };
// A rename is only inferred for a unique, unchanged file with an untouched peer.
// Duplicate content remains a normal copy/deletion decision.
export function detectSyncRenames(
  host: Map<string, string>,
  guest: Map<string, string>,
  previous: Record<string, string>,
) {
  const result: SyncRename[] = [];
  for (const [source, target, action] of [
    [host, guest, 'rename-guest'],
    [guest, host, 'rename-host'],
  ] as const) {
    const missing = new Map<string, string[]>(),
      added = new Map<string, string[]>();
    for (const [name, sha] of Object.entries(previous)) {
      if (!source.has(name) && target.get(name) === sha)
        missing.set(sha, [...(missing.get(sha) || []), name]);
    }
    for (const [name, sha] of source) {
      if (!Object.hasOwn(previous, name) && !target.has(name))
        added.set(sha, [...(added.get(sha) || []), name]);
    }
    for (const [sha, oldNames] of missing) {
      const newNames = added.get(sha);
      if (
        oldNames.length === 1 &&
        newNames?.length === 1 &&
        oldNames[0].toLowerCase() !== newNames[0].toLowerCase()
      )
        result.push({ from: oldNames[0], path: newNames[0], sha, action });
    }
  }
  return result;
}
