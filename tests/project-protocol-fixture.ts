import { randomUUID } from 'node:crypto';
import { Duplex, PassThrough } from 'node:stream';
import { projectVersion, type Project } from '../server/workspaces.ts';
import { projectIdentitySchema, projectIdentityRunSchema } from '../server/project-identity.ts';
import type { OwnedProjectProtocolStream, ProjectProtocolStreamRecord } from '../server/project-protocol-stream.ts';

export function protocolPair() {
  const request = new PassThrough(), response = new PassThrough();
  const pair = [Duplex.from({ readable: response, writable: request }), Duplex.from({ readable: request, writable: response })] as const;
  for (const channel of pair) channel.on('error', () => {}); return pair;
}
export function identityFor(project: Project) {
  const identityId = randomUUID();
  return projectIdentitySchema.parse({ version: 1, phase: 'active', registryId: randomUUID(),
    identityId, projectId: project._workspace || 'default', revision: 1,
    account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 21000, gid: 21000,
    directory: project.directory, directoryDevice: '1', directoryInode: '2',
    home: '/var/lib/sakura-project-homes/' + identityId, homeDevice: '1', homeInode: '3',
    networkIsolation: project.networkIsolation || 'host' });
}
export function runFor(identity: ReturnType<typeof identityFor>, runId = randomUUID(), bootId = randomUUID()) {
  return projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'inherit-current',
    registryId: identity.registryId, identityId: identity.identityId, revision: identity.revision,
    projectId: identity.projectId, runId, bootId, build: 'a'.repeat(64), networkDevice: '4', networkInode: '5',
    cgroupDevice: '6', cgroupInode: '7', cgroupName: 'sakura-task-' + runId,
    namespace: identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : '' });
}
export function mockProtocolOwner(id: string, kind: 'lsp' | 'dap', project: Project, stream: Duplex,
  verify: () => Promise<void>, cleanup: () => Promise<void>) {
  const identity = identityFor(project), run = runFor(identity);
  const record: ProjectProtocolStreamRecord = { version: 1, vmId: id, kind,
    projectId: identity.projectId, identity, runId: run.runId, bootId: run.bootId, controlToken: randomUUID(),
    configSha256: projectVersion(project), sha256: 'a'.repeat(64), timeoutMs: 180000, phase: 'active', issued: true, run };
  let resolve!: () => void; const done = new Promise<void>(yes => { resolve = yes; });
  let closed = false;
  const owner: OwnedProjectProtocolStream = { stream, capture: { projectId: identity.projectId, project,
    resolved: project, configSha256: record.configSha256, live: {}, bootId: run.bootId, signal: new AbortController().signal },
    record: () => structuredClone(record), assertCurrent: verify, assertNative: async () => {},
    detachRequest: () => {}, done, close: async () => {
      if (closed) return; await cleanup(); closed = true; stream.destroy(); resolve();
    } };
  return owner;
}
