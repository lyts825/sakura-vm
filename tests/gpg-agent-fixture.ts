import { gpgHostSnapshotSha256, type GpgHostSnapshot } from '../server/gpg-agent-host.ts';

/** Synthetic metadata for task ownership tests; this does not attest a host Agent. */
export function syntheticGpgHostSnapshot(): GpgHostSnapshot {
  const owner = 'S-1-5-21-1-2-3-1001';
  const anchor = { id: '1:00000000000000000000000000000001', owner,
    aclSha256: 'a'.repeat(64), attributes: 16, links: 1, directory: true, protectedAcl: true };
  const leaf = { ...anchor, id: '1:00000000000000000000000000000002',
    attributes: 32, directory: false, protectedAcl: false };
  const value = { version: 1 as const, hostHelperSha256: 'c'.repeat(64), pins: {
    kind: 'w32' as const, anchorPath: 'D:\\private', relativePath: 'e', anchor,
    ancestors: [anchor], descendants: [leaf], sourceFileSha256: 'b'.repeat(64), port: 12345,
    process: { pid: 123, creationTime: '134353495574608003', sid: owner,
      image: 'D:\\private\\bin\\gpg-agent.exe' },
  } };
  return { ...value, hostSourceSha256: gpgHostSnapshotSha256(value) };
}
