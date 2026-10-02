import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Machines } from '../server/machines.ts';
import { AppError } from '../server/model.ts';
import { projectSchema, type Project } from '../server/workspaces.ts';
import type { ProjectIdentityRun } from '../server/project-identity.ts';
import { ProjectCacheTransfers, projectCachedInstallCommand, projectCacheTransferLimits,
  type ProjectCacheTransferOptions, type ProjectCacheTransferOwner, type ProjectCacheTransferReply } from '../server/project-cache-transfer.ts';
import { projectCacheTransferControl } from '../server/project-cache-transfer-control.ts';
import type { ProjectTaskResourceContext, ProjectTaskResourceReceipt } from '../server/project-run-scope.ts';
import { projectIdentityTask } from '../server/project-run-scope.ts';
import { setVmStorageRoot } from '../server/model.ts';
import { scopeIdentityFixture } from './project-scope-identity-fixture.ts';

const projectId = '0123456789abcdef';
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'sakura-cache-transfer-')), vmId = randomUUID(), bootId = randomUUID();
  const live = { startedAt: 'fixture' }, registryId = randomUUID(), identityId = randomUUID();
  const identity = { version: 1 as const, phase: 'active' as const, registryId, projectId, identityId, revision: 1,
    account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 20001, gid: 20001,
    home: '/var/lib/sakura-project-homes/' + identityId, directory: '/srv/project',
    directoryDevice: '1', directoryInode: '2', homeDevice: '1', homeInode: '3', networkIsolation: 'private' as const };
  const context: ProjectTaskResourceContext = { identity, owner: { kind: 'task', runId: randomUUID(), bootId }, sha256: 'b'.repeat(64), live: live as any };
  const full: ProjectIdentityRun = { version: 1, phase: 'closed', mode: 'inherit-current', registryId, projectId, identityId, revision: 1,
    runId: context.owner.runId, bootId, build: 'a'.repeat(64), networkDevice: '4', networkInode: '5', cgroupDevice: '6',
    cgroupInode: '23456', cgroupName: 'sakura-task-' + context.owner.runId, namespace: 'sk-' + projectId };
  const receipts = new Map<string, ProjectCacheTransferReply>(), commands: any[] = [], retired: any[] = [];
  const state = { lostPrepareAck: false, failedRetire: false, groupAbsent: true, proof: { run: full } as ProjectTaskResourceReceipt };
  const machines = { live: new Map([[vmId, live]]), exec: async () => { throw new Error('Unapproved root control'); } } as unknown as Machines;
  const options: ProjectCacheTransferOptions = { rootDirectory: folder,
    source: async () => ({ manifest: { build: 'a'.repeat(64) } as any, files: new Map(), directory: '/trusted/build' }),
    scopes: { taskResources: async () => [], completeTaskResource: async (_id, value) => { assert.deepEqual(value.owner, context.owner); }, recoverStoppedTasks: async () => { if (!state.groupAbsent) throw new AppError('scope remains', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'); },
      taskResourceReceipt: async (_id, value) => { assert.deepEqual(value.identity, identity); assert.deepEqual(value.owner, context.owner); return state.proof; } },
    control: async (_id, request) => {
      commands.push(structuredClone(request));
      const owner = request.owner;
      if (request.action === 'prepare') {
        assert.equal(receipts.has(owner.stageId), false);
        const receipt = { version: 1 as const, phase: 'ready' as const, owner, stage: { device: '7', inode: '100' },
          data: { device: '7', inode: '101' }, manifest: { sha256: 'c'.repeat(64), bytes: 20, nodes: 3 }, task: null };
        const reply: ProjectCacheTransferReply = { version: 1, state: 'present', bootId, receipt }; receipts.set(owner.stageId, reply);
        if (state.lostPrepareAck) throw new Error('ack lost after root durable copy');
        return reply;
      }
      const result = receipts.get(owner.stageId) || { version: 1 as const, state: 'absent' as const, bootId };
      if (request.action === 'probe') return structuredClone(result);
      assert.ok(state.groupAbsent, 'retirement cannot kill or ignore a present/replacement domain');
      assert.deepEqual(request.task, state.proof);
      if (state.failedRetire) throw new AppError('fsync or unlink failed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      if (result.state === 'absent') return result;
      const next = { ...result, receipt: { ...result.receipt, phase: 'closed' as const, task: request.task! } };
      receipts.set(owner.stageId, next); retired.push(owner.stageId); return next;
    },
  };
  const project = Object.defineProperty(projectSchema.parse({ directory: identity.directory, networkIsolation: 'private' }),
    '_workspace', { value: projectId, enumerable: false }) as Project;
  const transfers = new ProjectCacheTransfers(machines, options);
  const allocate = (manager: 'npm' | 'pip' = 'npm') => transfers.allocate(vmId, project, manager, new AbortController().signal, live as any);
  const records = async () => {
    const root = join(folder, 'project-cache-transfers', projectId);
    let names: string[]; try { names = await readdir(root); } catch { return []; }
    return Promise.all(names.filter(name => name.endsWith('.json')).map(name => readFile(join(root, name), 'utf8').then(JSON.parse)));
  };
  return { allocate, transfers, options, vmId, folder, context, state, receipts, commands, retired, records, full, project,
    dispose: () => rm(folder, { recursive: true, force: true }) };
}

test('npm and pip get distinct writable copies bound to one exact native owner; retirement archives the full proof', async () => {
  for (const manager of ['npm', 'pip'] as const) {
    const f = await fixture();
    try {
      const allocation = await f.allocate(manager); await allocation.resource.prepare(f.context);
      assert.equal(f.commands[0].action, 'prepare'); assert.equal(f.commands[0].owner.manager, manager);
      assert.equal(f.commands[0].owner.identity.projectId, projectId);
      assert.equal(f.commands[0].owner.owner.runId, f.context.owner.runId);
      assert.equal(f.commands[0].owner.sha256, f.context.sha256);
      assert.equal((await f.records())[0].phase, 'prepared');
      const command = projectCachedInstallCommand(f.project.directory, allocation.directory, manager);
      assert.equal(command.includes('/var/cache/'), false);
      assert.equal(command.includes("cd '/srv/project'"), false);
      assert.match(command, /\/run\/sakura-project-cache-transfers\/[a-f0-9-]{36}\/data/);
      assert.match(command, manager === 'npm' ? /npm ci --offline --ignore-scripts/ : /--no-index --no-build-isolation --only-binary=:all:/);
      await allocation.resource.retire(f.context, f.state.proof);
      assert.deepEqual(await f.records(), []); assert.deepEqual(f.retired, [allocation.stageId]);
      const path = join(f.folder, 'project-cache-transfers', projectId, 'closed', allocation.stageId.slice(0, 2), allocation.stageId + '.json');
      const closed = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(closed.phase, 'closed'); assert.deepEqual(closed.task.run, f.full);
      await assert.rejects(allocation.resource.prepare(f.context));
    } finally { await f.dispose(); }
  }
});

test('lost preparation ACK keeps run:null intent, then exact native never-issued proof safely retires the partial copy', async () => {
  const f = await fixture(); f.state.lostPrepareAck = true; f.state.proof = { run: null };
  try {
    const allocation = await f.allocate(); await assert.rejects(allocation.resource.prepare(f.context), /ack lost/);
    const intent = (await f.records())[0]; assert.equal(intent.phase, 'intent'); assert.equal(intent.preparation, null);
    await allocation.resource.retire(f.context, f.state.proof);
    assert.deepEqual(await f.records(), []); assert.deepEqual(f.commands.map(value => value.action), ['prepare', 'probe', 'retire']);
  } finally { await f.dispose(); }
});

test('orphan recovery first obtains the original full native closure and never repeats prepare or UID execution', async () => {
  const f = await fixture();
  try {
    const allocation = await f.allocate(); await allocation.resource.prepare(f.context);
    f.state.failedRetire = true; await assert.rejects(allocation.resource.retire(f.context, f.state.proof));
    const pending = (await f.records())[0]; assert.deepEqual(pending.task.run, f.full); assert.equal(pending.phase, 'retiring');
    f.state.failedRetire = false; await new ProjectCacheTransfers((f.transfers as any).machines, f.options).recover(f.vmId, projectId);
    assert.deepEqual(await f.records(), []); assert.equal(f.commands.filter(value => value.action === 'prepare').length, 1);
  } finally { await f.dispose(); }
});

test('wrong project, task cgroup name or payload digest cannot retire a prepared copy', async () => {
  const f = await fixture();
  try {
    const allocation = await f.allocate(); await allocation.resource.prepare(f.context);
    await assert.rejects(allocation.resource.retire({ ...f.context, sha256: 'd'.repeat(64) }, f.state.proof));
    await assert.rejects(allocation.resource.retire({ ...f.context, identity: { ...f.context.identity, projectId: 'default' } }, f.state.proof));
    await assert.rejects(allocation.resource.retire(f.context, { run: { ...f.full, cgroupName: 'sakura-task-' + randomUUID() } }));
    assert.equal((await f.records())[0].phase, 'prepared'); assert.equal(f.retired.length, 0);
  } finally { await f.dispose(); }
});

test('stage/data inode replacement is rejected before unlink and preserves the original full task proof', async () => {
  for (const field of ['stage', 'data'] as const) {
    const f = await fixture();
    try {
      const allocation = await f.allocate(); await allocation.resource.prepare(f.context);
      const reply = f.receipts.get(allocation.stageId)!; assert.equal(reply.state, 'present');
      if (reply.state === 'present') reply.receipt[field].inode = '99999';
      await assert.rejects(allocation.resource.retire(f.context, f.state.proof), (e: any) => e.status === 503);
      const pending = (await f.records())[0]; assert.deepEqual(pending.task.run, f.full);
      assert.equal(pending.preparation[field].inode, field === 'stage' ? '100' : '101'); assert.equal(f.retired.length, 0);
    } finally { await f.dispose(); }
  }
});

test('a present original/replacement cgroup causes retirement failure while the full pinned proof remains recoverable', async () => {
  const f = await fixture();
  try {
    const allocation = await f.allocate(); await allocation.resource.prepare(f.context); f.state.groupAbsent = false;
    await assert.rejects(allocation.resource.retire(f.context, f.state.proof));
    const pending = (await f.records())[0]; assert.deepEqual(pending.task.run, f.full); assert.equal(pending.phase, 'retiring');
    const count = f.commands.length;
    await assert.rejects(f.transfers.recover(f.vmId, projectId)); assert.equal(f.commands.length, count);
  } finally { await f.dispose(); }
});

test('unlink/fsync failure retains the accurate task and cache proof, never closing or overwriting the journal', async () => {
  const f = await fixture();
  try {
    const allocation = await f.allocate(); await allocation.resource.prepare(f.context); f.state.failedRetire = true;
    await assert.rejects(allocation.resource.retire(f.context, f.state.proof));
    const first = (await f.records())[0]; assert.equal(first.phase, 'retiring'); assert.deepEqual(first.task.run, f.full);
    await assert.rejects(allocation.resource.retire(f.context, f.state.proof)); assert.deepEqual((await f.records())[0], first);
    f.state.failedRetire = false; await allocation.resource.retire(f.context, f.state.proof); assert.deepEqual(await f.records(), []);
  } finally { await f.dispose(); }
});

test('lost retirement ACK is recovered from a closed root tombstone without replaying execution or deletion', async () => {
  const f = await fixture();
  try {
    const allocation = await f.allocate(); await allocation.resource.prepare(f.context);
    const original = f.options.control!; let lost = true;
    f.options.control = async (...args) => { const reply = await original(...args); if (args[1].action === 'retire' && lost) { lost = false; throw new Error('closed ACK lost'); } return reply; };
    await assert.rejects(allocation.resource.retire(f.context, f.state.proof));
    await allocation.resource.retire(f.context, f.state.proof); assert.deepEqual(await f.records(), []);
    assert.equal(f.commands.filter(value => value.action === 'prepare').length, 1);
  } finally { await f.dispose(); }
});

test('a retirement transport failure remains cleanup 503 with the original full proof and preserves an existing 503 object', async () => {
  for (const failure of [new Error('retirement connection lost'), new AppError('original cleanup pending', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')]) {
    const f = await fixture();
    try {
      const allocation = await f.allocate(); await allocation.resource.prepare(f.context);
      const control = f.options.control!;
      f.options.control = async (...args) => { if (args[1].action === 'retire') throw failure; return control(...args); };
      await assert.rejects(allocation.resource.retire(f.context, f.state.proof), (error: any) => {
        assert.equal(error.status, 503); assert.equal(error.code, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        if (failure instanceof AppError) assert.equal(error, failure);
        return true;
      });
      const record = (await f.records())[0]; assert.equal(record.phase, 'retiring'); assert.deepEqual(record.task.run, f.full);
      assert.equal(f.retired.length, 0);
    } finally { await f.dispose(); }
  }
});

test('read-only probe and malformed JSON never mutate the host receipt', async () => {
  const f = await fixture();
  try {
    const allocation = await f.allocate(); await allocation.resource.prepare(f.context);
    const record = (await f.records())[0], path = join(f.folder, 'project-cache-transfers', projectId, allocation.stageId + '.json');
    const before = await readFile(path, 'utf8'); const result = await f.options.control!(f.vmId, { action: 'probe', owner: record.owner });
    assert.equal(result.state, 'present'); assert.equal(await readFile(path, 'utf8'), before);
    await writeFile(path, '{malformed'); await assert.rejects(allocation.resource.retire(f.context, f.state.proof));
    assert.equal(await readFile(path, 'utf8'), '{malformed'); assert.equal(f.retired.length, 0);
  } finally { await f.dispose(); }
});

test('a missing cache host receipt is reconstructed only from the exact durable original native resource descriptor', async () => {
  const f = await fixture();
  try {
    const allocation = await f.allocate(); await allocation.resource.prepare(f.context);
    f.state.failedRetire = true; await assert.rejects(allocation.resource.retire(f.context, f.state.proof));
    await rm(join(f.folder, 'project-cache-transfers', projectId, allocation.stageId + '.json'));
    f.options.scopes!.taskResources = async () => [{ context: f.context, descriptor: allocation.resource.descriptor, active: false }];
    f.state.failedRetire = false;
    await f.transfers.recover(f.vmId, projectId);
    assert.deepEqual(await f.records(), []); assert.equal(f.retired.length, 1);
    assert.equal(f.commands.filter(value => value.action === 'prepare').length, 1);
  } finally { await f.dispose(); }
});

test('real native journals bind both manager copies before issuance and retain the original task through resource retirement', async () => {
  for (const manager of ['npm', 'pip'] as const) {
    const f = await fixture(), commands: string[] = [];
    const machines = (f.transfers as any).machines as Machines;
    machines.get = () => ({ distro: 'alpine' }) as any;
    machines.state = () => 'running'; machines.locked = async (_id, action) => action();
    machines.exec = async (_id, command) => { commands.push(command); return { code: 0, stdout: '', stderr: '' }; };
    setVmStorageRoot(f.vmId, f.folder);
    const native = scopeIdentityFixture(machines, f.project, () => f.context.owner.bootId, () => null);
    delete f.options.scopes;
    f.options.rootDirectory = join(f.folder, f.vmId);
    f.options.control = async (_id, request) => {
      const owner = request.owner;
      const journalPath = join(f.folder, f.vmId, 'project-identities', projectId + '.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8')), entry = journal.runs.find((run: any) => run.runId === owner.owner.runId);
      assert.equal(entry.cacheTransfer.stageId, owner.stageId); assert.equal(entry.sha256, owner.sha256);
      assert.deepEqual(entry.identity, owner.identity);
      f.commands.push(structuredClone(request));
      if (request.action === 'prepare') {
        assert.equal(entry.phase, 'intent'); assert.equal(entry.run, null);
        const reply: ProjectCacheTransferReply = { version: 1, state: 'present', bootId: owner.owner.bootId,
          receipt: { version: 1, phase: 'ready', owner, stage: { device: '7', inode: '100' }, data: { device: '7', inode: '101' },
            manifest: { sha256: 'c'.repeat(64), bytes: 30, nodes: 3 }, task: null } };
        f.receipts.set(owner.stageId, reply); return reply;
      }
      const prepared = f.receipts.get(owner.stageId)!;
      if (request.action === 'probe') return prepared;
      assert.equal(entry.phase, 'closed'); assert.equal(entry.cacheTransfer.phase, 'pending');
      assert.deepEqual(entry.run, request.task?.run); assert.deepEqual(native.tickets.get(owner.owner.runId), request.task?.run);
      assert.equal(request.task?.run?.phase, 'closed'); assert.equal(request.task?.run?.cgroupInode, '23456');
      assert.equal(prepared.state, 'present');
      if (prepared.state !== 'present') throw new Error('missing exact preparation');
      const closed = { ...prepared, receipt: { ...prepared.receipt, phase: 'closed' as const, task: request.task! } };
      f.receipts.set(owner.stageId, closed); return closed;
    };
    const transfers = new ProjectCacheTransfers(machines, f.options);
    try {
      const allocation = await transfers.allocate(f.vmId, f.project, manager, new AbortController().signal, machines.live.get(f.vmId)!);
      await projectIdentityTask(machines, f.vmId, f.project,
        { command: projectCachedInstallCommand(f.project.directory, allocation.directory, manager), environment: { TOKEN: 'cache-private-token' } },
        new AbortController().signal, undefined, 600000, undefined, undefined,
        { expectedLive: machines.live.get(f.vmId), resource: allocation.resource });
      assert.equal(native.inputs.length, 1); assert.equal(native.tickets.size, 1);
      assert.ok(commands.every(command => !command.includes('cache-private-token') && !command.includes('npm ci') && !command.includes('pip install')));
      const ticket = [...native.tickets.values()][0];
      const journal = JSON.parse(await readFile(join(f.folder, f.vmId, 'project-identities', projectId + '.json'), 'utf8'));
      assert.equal(journal.runs[0].phase, 'closed'); assert.equal(journal.runs[0].cacheTransfer.phase, 'closed');
      assert.deepEqual(journal.runs[0].run, ticket); assert.equal(ticket.projectId, projectId);
    } finally { setVmStorageRoot(f.vmId); await f.dispose(); }
  }
});

test('a live replacement during final resource confirmation retains the pending descriptor and original closed native proof', async () => {
  const f = await fixture(), machines = (f.transfers as any).machines as Machines;
  machines.get = () => ({ distro: 'alpine' }) as any;
  machines.state = () => 'running'; machines.locked = async (_id, action) => action();
  machines.exec = async () => ({ code: 0, stdout: '', stderr: '' });
  setVmStorageRoot(f.vmId, f.folder);
  const native = scopeIdentityFixture(machines, f.project, () => f.context.owner.bootId, () => null);
  try {
    await assert.rejects(projectIdentityTask(machines, f.vmId, f.project, { command: 'true' },
      new AbortController().signal, undefined, 600000, undefined, undefined, {
        expectedLive: machines.live.get(f.vmId), resource: {
          descriptor: { stageId: randomUUID(), manager: 'npm', build: 'a'.repeat(64) },
          prepare: async () => {},
          retire: async () => {
            const original = machines.exec;
            machines.exec = async (...args) => {
              const result = await original(...args);
              if (args[1].includes('assert not os.path.lexists') && args[1].includes('sakura-task-'))
                machines.live.set(f.vmId, { startedAt: 'replacement' } as any);
              return result;
            };
          },
        },
      }), (error: any) => error.status === 503);
    const journal = JSON.parse(await readFile(join(f.folder, f.vmId, 'project-identities', projectId + '.json'), 'utf8'));
    assert.equal(journal.runs[0].phase, 'closed');
    assert.equal(journal.runs[0].cacheTransfer.phase, 'pending');
    assert.deepEqual(journal.runs[0].run, [...native.tickets.values()][0]);
    assert.equal(journal.runs[0].run.phase, 'closed');
    assert.equal(native.inputs.length, 1);
  } finally { setVmStorageRoot(f.vmId); await f.dispose(); }
});

test('actual root controller compiles and its POSIX model exercises source links, bounds, lost ACK, inode and fsync failures', () => {
  const path = fileURLToPath(new URL('./project-cache-transfer-control-model.py', import.meta.url));
  const output = spawnSync(process.env.SAKURA_TEST_PYTHON || 'python', ['-I', '-S', path], {
    input: projectCacheTransferControl, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  });
  assert.equal(output.error, undefined); assert.equal(output.status, 0, output.stderr);
  const result = JSON.parse(output.stdout); assert.ok(result.tests >= 15);
  assert.deepEqual(result.limits, { file: projectCacheTransferLimits.fileBytes, total: projectCacheTransferLimits.totalBytes,
    nodes: projectCacheTransferLimits.nodes, depth: projectCacheTransferLimits.depth });
});
