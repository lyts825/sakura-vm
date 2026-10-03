import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines } from '../server/machines.ts';
import { AppError, setVmStorageRoot } from '../server/model.ts';
import { Workspaces, projectSchema, projectVersion } from '../server/workspaces.ts';
import { projectIdentitySchema, projectIdentityRunSchema, type ProjectIdentityRun } from '../server/project-identity.ts';
import { SingleAppWindows } from '../server/single-app-windows.ts';
import { appIdentity, appReceiptSchema, appOriginHash, type AppReceipt, type AppOrigin } from '../server/single-app-sandbox.ts';

export const APP_BUILD = 'a'.repeat(64), NATIVE_BUILD = 'b'.repeat(64);
export async function singleAppFixture(configuration: { exitPollMs?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sakura-single-app-run-')), id = randomUUID(), bootId = randomUUID(), rebootId = randomUUID();
  setVmStorageRoot(id, root); await mkdir(join(root, id));
  const file = join(root, id, 'single-app-runs.json');
  await writeFile(join(root, id, 'projects.json'), JSON.stringify({ active: 'default', projects: [
    { id: 'default', name: '默认项目' }, { id: '1234567890abcdef', name: '其他项目' }] }));
  const commands: string[] = [], actions: { action: string; id?: string; origin?: AppOrigin; environment?: Record<string, string> }[] = [];
  const faults = { prepareAckLost: false, missingNativeTicket: false, unknownGroup: false, startAckLost: false,
    stopFail: false, stopAckLost: false, endpointChanged: false, stopForeignRun: false, missingDirectory: false, statusExited: false, reboot: false };
  const live = { status: 'running' }, runs = new Map<string, ProjectIdentityRun>(), receipts = new Map<string, AppReceipt>();
  let releases = 0, nextUid = 1100;
  const locks = new Set<string>();
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, { id }]]), live: new Map([[id, live]]), get: () => ({ id, distro: 'alpine', template: 'none' }),
    requireUnlocked: () => {}, state: () => live.status,
    locked: async (key: string, task: () => Promise<unknown>) => {
      if (locks.has(key)) throw new Error('another operation is running');
      locks.add(key); try { return await task(); } finally { locks.delete(key); }
    },
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stdout: command === 'cat /proc/sys/kernel/random/boot_id' ? (faults.reboot ? rebootId : bootId) + '\n'
        : command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS') ? 'absent\n' : '', stderr: '' };
    },
  }) as unknown as Machines;
  const workspaces = new Workspaces(machines), configs = new Map([
    ['default', projectSchema.parse({ directory: '/private/project', networkIsolation: 'private', environment: { LITERAL: '$(never-run)' } })],
    ['1234567890abcdef', projectSchema.parse({ directory: '/other/project', networkIsolation: 'host' })],
  ]);
  workspaces.config = async vmId => {
    const scope = workspaces.projects.current(vmId), project = structuredClone(configs.get(scope)!);
    Object.defineProperty(project, '_workspace', { value: scope, enumerable: false });
    return project;
  };
  const registryId = randomUUID(), identities = new Map<string, ReturnType<typeof projectIdentitySchema.parse>>();
  const scopes = { identity: async (_id: string, project: Awaited<ReturnType<Workspaces['config']>>) => {
    const scope = project._workspace || 'default';
    let identity = identities.get(scope);
    if (!identity) {
      const identityId = randomUUID();
      identity = projectIdentitySchema.parse({ version: 1, phase: 'active', registryId, projectId: scope, identityId, revision: 1,
        account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 20000 + identities.size, gid: 20000 + identities.size,
        home: '/var/lib/sakura-project-homes/' + identityId, directory: project.directory,
        directoryDevice: '1', directoryInode: '2', homeDevice: '1', homeInode: '3', networkIsolation: project.networkIsolation || 'host' });
      identities.set(scope, identity);
    }
    return identity;
  } };
  const terminals = { prepare: async (_id: string, scope: string | null | undefined) => {
    if (faults.missingDirectory) throw new AppError('请先显式准备并迁移原目录', 409, 'PROJECT_IDENTITY_DIRECTORY_MISSING');
    const project = await workspaces.projects.inScope(id, scope!, () => workspaces.config(id));
    let released = false;
    return { command: '', terminalId: undefined, projectId: scope!, networkIsolation: project.networkIsolation || 'host',
      captured: { project, configVersion: projectVersion(project), live: machines.live.get(id)! },
      release: () => { assert.equal(released, false, 'preparation lease released twice'); released = true; releases++; } };
  }, close: async () => {} };
  const core = { install: async () => NATIVE_BUILD,
    prepare: async (_id: string, identity: ReturnType<typeof projectIdentitySchema.parse>, options: { runId?: string } = {}) => {
    const runId = options.runId!;
    const journal = JSON.parse(await readFile(file, 'utf8'));
    assert.ok(journal.sessions.some((session: { id: string; phase: string; run: unknown }) =>
      session.id === runId && session.phase === 'intent' && session.run === null), 'intent must precede native mutation');
    actions.push({ action: 'native-prepare', id: runId });
    const run = projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'independent', registryId: identity.registryId,
      identityId: identity.identityId, projectId: identity.projectId, runId, revision: identity.revision, bootId, build: NATIVE_BUILD,
      networkDevice: '4', networkInode: '5', cgroupDevice: '6', cgroupInode: String(100 + runs.size),
      cgroupName: 'sakura-identity-' + runId, namespace: identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : '' });
    if (!faults.missingNativeTicket) runs.set(runId, run);
    if (faults.prepareAckLost || faults.missingNativeTicket) throw new AppError('native ACK lost', 502, 'PROJECT_IDENTITY_CONTROL_FAILED');
    return run;
  }, runReadonly: async (_id: string, _identity: unknown, runId: string) => {
    const run = runs.get(runId); if (!run) throw new AppError('missing', 409, 'PROJECT_IDENTITY_RECORD_ABSENT'); return run;
  } };
  const image = { path: '/usr/bin/xterm', command: '/usr/bin/xterm', device: '1', inode: '12', sha256: 'c'.repeat(64) };
  const tool = { ...image, command: image.path };
  const control = { install: async () => APP_BUILD, legacy: async () => [],
    prepareRun: async (vmId: string, _build: string, request: { id: string; identity: ReturnType<typeof projectIdentitySchema.parse> }) =>
      core.prepare(vmId, request.identity, { runId: request.id }),
    streamCommand: (build: string, origin: AppOrigin) => `/fixed/${build}/controller.py stream ${origin.run.runId} ${appOriginHash(origin)}`,
    recover: async (_id: string, _build: string, request: { id: string; bootId: string; nativeBuild: string }) => {
      actions.push({ action: 'recover', id: request.id });
      if (faults.unknownGroup) throw new AppError('unknown original cgroup', 503, 'SINGLE_APP_INTENT_CLEANUP_UNCONFIRMED');
      const run = runs.get(request.id);
      return run ? { run, absence: null } : { run: null, absence: { version: 1 as const, id: request.id, bootId: request.bootId,
        nativeBuild: request.nativeBuild, currentBootId: bootId, ticketAbsent: true as const, cgroupAbsent: true as const,
        guestReceiptAbsent: true as const, runtimeAbsent: true as const } };
    },
    call: async (_id: string, _build: string, action: 'prepare' | 'start' | 'status' | 'stop', origin: AppOrigin,
      environment?: Record<string, string>) => {
      actions.push({ action, id: origin.run.runId, origin, environment });
      const runId = origin.run.runId;
      if (action === 'prepare') {
        const account = appIdentity(runId), uid = nextUid++, display = 10 + receipts.size;
        const receipt = appReceiptSchema.parse({ version: 1, id: runId, build: APP_BUILD, origin, identity: origin.identity, run: origin.run,
          state: 'prepared', uid, gid: uid, user: account.user, home: account.home, homeDevice: '1', homeInode: String(uid),
          runtime: '/run/sakura-single-app-uid/' + runId, runtimeDevice: '7', runtimeInode: String(uid + 1), password: 'Abc/123+',
          display, port: 5900 + display, image, tools: { group: tool, account: tool, ipv4: tool, ipv6: tool,
            vnc: tool, password: tool, wm: tool, probe: tool }, directoryView: null, supervisor: null, endpoint: null,
          processes: null, retirement: null, firewall: 'active' });
        receipts.set(runId, receipt); return structuredClone(receipt);
      }
      const receipt = receipts.get(runId);
      if (action === 'stop') {
        if (faults.stopFail) throw new AppError('original cleanup unknown', 503, 'SINGLE_APP_CLEANUP_UNCONFIRMED');
        const retirement = faults.reboot ? { reason: 'guest-reboot' as const, bootId: rebootId } : null;
        if (receipt) { receipt.state = 'stopped'; receipt.firewall = 'closed'; receipt.retirement = retirement; }
        const closed = { ...origin.run, phase: faults.reboot ? 'active' as const : 'closed' as const };
        runs.set(runId, closed);
        if (faults.stopAckLost) { faults.stopAckLost = false; throw new AppError('stop ACK lost', 503, 'SINGLE_APP_CONTROL_UNCONFIRMED'); }
        return { receipt: receipt ? structuredClone(receipt) : null,
          run: faults.stopForeignRun ? { ...closed, cgroupInode: '999' } : closed, retirement };
      }
      assert.ok(receipt, 'native guest receipt required');
      if (action === 'start') {
        receipt.state = 'running';
        receipt.directoryView = { version: 1, device: '8', inode: String(receipt.uid), directoryDevice: origin.identity.directoryDevice,
          directoryInode: origin.identity.directoryInode, directoryMode: 0o700, mountFlags: 6, projectUid: origin.identity.uid,
          projectGid: origin.identity.gid, uid: receipt.uid, gid: receipt.gid, desktopRunId: runId, bootId: origin.run.bootId, route: null };
        receipt.supervisor = { pid: receipt.uid, created: '10', image: '/usr/bin/python3', device: '1', inode: '99' };
        receipt.endpoint = { pid: receipt.uid + 1, created: '11', image: image.path, device: image.device, inode: image.inode, kernelInode: '55' };
        receipt.processes = { application: { pid: receipt.uid + 2, created: '12', image: image.path, device: '1', inode: '12' },
          wm: { pid: receipt.uid + 3, created: '13', image: image.path, device: '1', inode: '12' } };
        if (faults.startAckLost) throw new AppError('start ACK lost', 503, 'SINGLE_APP_CONTROL_UNCONFIRMED');
        return structuredClone(receipt);
      }
      return { state: faults.statusExited ? 'exited' : receipt.state === 'running' ? 'running' : 'stopped', receipt: structuredClone(receipt), bootId,
        endpoint: faults.endpointChanged ? { ...receipt.endpoint!, created: '99' } : structuredClone(receipt.endpoint) };
    } };
  const options = { terminals, scopes, identities: core, control, nativeBuild: async () => NATIVE_BUILD,
    exitPollMs: configuration.exitPollMs ?? 60_000 };
  const apps = new SingleAppWindows(machines, workspaces, options);
  return { root, id, file, bootId, rebootId, live, machines, workspaces, configs, apps, options, actions, commands, faults, receipts, runs,
    releaseCount: () => releases,
    journal: async () => JSON.parse(await readFile(file, 'utf8')),
    async close() {
      faults.stopFail = faults.unknownGroup = faults.stopForeignRun = false;
      await apps.close(); await workspaces.close(); setVmStorageRoot(id);
      const path = await realpath(root);
      assert.equal(dirname(path), resolve(tmpdir())); assert.ok(basename(path).startsWith('sakura-single-app-run-'));
      await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } };
}
