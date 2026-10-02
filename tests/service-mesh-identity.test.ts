import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Project } from '../server/workspaces.ts';
const parent = process.env.SAKURA_DATA_DIR || tmpdir();
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'sakura-mesh-identity-tests-')); process.env.SAKURA_DATA_DIR = root;
const { meshIdentityFixture } = await import('./service-mesh-identity-fixture.ts');
const { ServiceMesh, meshRunSchema, envoySidecarConfig } = await import('../server/service-mesh.ts');
const { ProjectMeshScope, projectMeshScopePaths, projectServiceScopePaths, projectNotebookScopePaths,
  projectReverseTunnelScopePaths, projectMeshRecordSchema } = await import('../server/project-service-scope.ts');
const { meshControlCommand, meshInspectInput, meshConfigInput, meshProcessInput, meshEnvoyExecution,
  meshConfigPlan, meshConfigSchema } = await import('../server/service-mesh-identity.ts');
const policy = { name: 'api', listenPort: 15300, upstreamPort: 8080 };
after(async () => { assert.equal(dirname(resolve(root)), resolve(parent)); assert.match(basename(root), /^sakura-mesh-identity-tests-/);
  await rm(root, { recursive: true, force: true }); });
async function fixture(t: { after: (action: () => Promise<unknown>) => void }) {
  const f = await meshIdentityFixture(); t.after(() => f.close()); return f;
}
async function ready(t: { after: (action: () => Promise<unknown>) => void }) {
  const f = await fixture(t); await f.mesh.action(f.id, { mode: 'save', policy }, 'run'); return f;
}
async function running(t: { after: (action: () => Promise<unknown>) => void }) {
  const f = await ready(t); await f.mesh.action(f.id, { mode: 'start' }, 'run'); return f;
}
const is503 = (error: any) => error?.status === 503;
function originalScope(project: Project, id: string) {
  return Object.defineProperty(structuredClone(project), '_workspace', { value: id === 'default' ? undefined : id, enumerable: false });
}

test('ordinary status neither executes project code nor resolves project secrets or issues a task', async t => {
  const f = await ready(t), count = f.state.taskCalls, preparations = f.state.preparations;
  f.state.resolutionHook = async () => { throw new Error('status must not resolve a project environment'); };
  const view = await f.mesh.status(f.id);
  assert.equal(view.envoyUsable, null); assert.equal(view.version, null); assert.equal(view.executed, false);
  assert.equal(f.state.taskCalls, count); assert.equal(f.state.preparations, preparations);
  assert.equal(f.state.resolutions, 0); assert.equal((await f.read()).tasks.length, 0);
});
test('explicit version check caches only the original project/config/boot and closes the complete finite task', async t => {
  const f = await ready(t), view = await f.mesh.action(f.id, { mode: 'status' }, 'check');
  assert.equal(view.envoyUsable, true); assert.equal(view.version, 'envoy version: fixture');
  assert.equal(view.executed, false); assert.equal(f.state.taskCalls, 1); assert.equal(f.held.get('default'), 0);
  const taskEnd = f.events.indexOf('default:task-full-domain-absent'), retired = f.events.indexOf('default:task-native-ticket-retired'),
    release = f.events.indexOf('default:release');
  assert.ok(taskEnd >= 0 && taskEnd < retired && retired < release);
  f.state.resolutionHook = async () => { throw new Error('cached status must remain a read'); };
  const status = await f.mesh.status(f.id); assert.equal(status.version, view.version); assert.equal(f.state.taskCalls, 1);
  f.state.bootId = randomUUID(); assert.equal((await f.mesh.status(f.id)).version, null); assert.equal(f.state.taskCalls, 1);
});

test('first private start observes the namespace created by its own preparation before executing Envoy', async t => {
  const f = await fixture(t);
  await f.workspaces.save(f.id, { networkIsolation: 'private' });
  await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
  f.state.namespacePresent = false;
  f.state.prepareHook = () => { f.state.namespacePresent = true; };
  const view = await f.mesh.action(f.id, { mode: 'start' }, 'run');
  assert.equal(view.bindingValid, true); assert.equal(f.state.starts, 1);
  assert.equal(f.state.preparations, 1); assert.equal(f.state.taskCalls, 2);
});

test('only an explicit private check prepares a missing namespace and publishes a UID compatibility sample', async t => {
  const f = await fixture(t);
  await f.workspaces.save(f.id, { networkIsolation: 'private' });
  await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
  f.state.namespacePresent = false;
  f.state.prepareHook = () => { f.state.namespacePresent = true; };
  const before = await f.mesh.status(f.id);
  assert.equal(before.namespacePresent, false); assert.equal(before.ready, false);
  assert.equal(f.state.preparations, 0); assert.equal(f.state.namespacePresent, false);
  const checked = await f.mesh.action(f.id, { mode: 'status' }, 'check');
  assert.equal(checked.namespacePresent, true); assert.equal(checked.ready, true);
  assert.equal(f.state.taskCalls, 1); assert.equal(f.state.starts, 0);
  assert.equal(f.held.get('default'), 0);
});

for (const mode of ['start', 'check'] as const) for (const field of ['boot', 'binary'] as const)
  test(mode + ' rejects a changed original ' + field + ' after preparation before any UID execution', async t => {
    const f = await ready(t);
    f.state.prepareHook = () => {
      if (field === 'boot') f.state.bootId = randomUUID();
      else f.binary.inode = '99001';
    };
    await assert.rejects(f.mesh.action(f.id, { mode: mode === 'check' ? 'status' : 'start' }, mode === 'check' ? 'check' : 'run'),
      (error: any) => error.code === 'SERVICE_SCOPE_CHANGED');
    assert.equal(f.state.taskCalls, 0); assert.equal(f.state.starts, 0);
    assert.equal((await f.read()).tasks.length, 0); assert.equal((await f.read()).runs.length, 0);
    assert.equal(f.held.get('default'), 0);
  });
test('cached Envoy compatibility becomes unknown after a system binary is replaced', async t => {
  const f = await ready(t); await f.mesh.action(f.id, { mode: 'status' }, 'check');
  f.binary.mtimeNs = '124000'; const view = await f.mesh.status(f.id);
  assert.equal(view.envoyUsable, null); assert.equal(view.version, null); assert.equal(f.state.taskCalls, 1);
});
test('named projects preserve a non-enumerable scope and use distinct persistent accounts and homes', async t => {
  const f = await fixture(t);
  const ids: string[] = [];
  for (const name of ['alpha', 'beta']) {
    const id = (await f.workspaces.projects.create(f.id, name, async () => {
      await f.workspaces.save(f.id, { directory: '/workspace/' + name, networkIsolation: 'private', environment: { PROJECT_VALUE: name } });
    })).active; ids.push(id);
    await f.workspaces.projects.inScope(f.id, id, async () => {
      await f.mesh.action(f.id, { mode: 'save', policy }, 'run'); await f.mesh.action(f.id, { mode: 'start' }, 'run');
    });
  }
  const [alpha, beta] = ids.map(id => f.identities.get(id)!);
  assert.notEqual(alpha.uid, beta.uid); assert.notEqual(alpha.home, beta.home);
  assert.equal(alpha.uid, alpha.gid); assert.equal(beta.uid, beta.gid);
  for (const execution of f.executions) {
    const descriptor = Object.getOwnPropertyDescriptor(execution.project, '_workspace')!;
    assert.equal(descriptor.enumerable, false); assert.ok(ids.includes(descriptor.value));
    assert.equal(execution.project.directory, '/workspace/' + execution.environment?.PROJECT_VALUE);
  }
  assert.equal(f.state.resolutions, 2, 'one resolution per start, reused by version, validation and the long-running process');
  assert.equal(f.rootLaunches.length, 2);
  assert.ok(f.rootLaunches.every(command => !command.includes('PROJECT_VALUE') && !command.includes('/workspace/')));
});
test('selecting a different UI project while resolving does not redirect the original scoped operation', async t => {
  const f = await fixture(t);
  const alpha = (await f.workspaces.projects.create(f.id, 'alpha', async () => {
    await f.workspaces.save(f.id, { directory: '/workspace/alpha', networkIsolation: 'private' });
  })).active;
  const beta = (await f.workspaces.projects.create(f.id, 'beta', async () => {
    await f.workspaces.save(f.id, { directory: '/workspace/beta', networkIsolation: 'private' });
  })).active;
  await f.workspaces.projects.inScope(f.id, alpha, async () => {
    await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
    f.state.resolutionHook = async () => { await f.workspaces.projects.update(f.id, beta); };
    const view = await f.mesh.action(f.id, { mode: 'start' }, 'run');
    assert.equal(view.projectId, alpha); assert.equal(view.directory, '/workspace/alpha');
  });
  assert.equal(f.running.has(alpha), true); assert.equal(f.running.has(beta), false);
});
test('live replacement before execution rejects the original operation without following the replacement', async t => {
  const f = await ready(t);
  f.state.resolutionHook = async () => { f.machines.live.set(f.id, {} as any); };
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'));
  assert.equal(f.state.taskCalls, 0); assert.equal(f.state.starts, 0); assert.equal(f.held.get('default'), 0);
  assert.equal((await f.read()).runs.length, 0);
});
test('a config change during resolution cannot execute a newly resolved project command', async t => {
  const f = await ready(t);
  f.state.resolutionHook = async () => { await f.workspaces.save(f.id, { environment: { CHANGED: 'new' } }); };
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'));
  assert.equal(f.state.taskCalls, 0); assert.equal(f.state.starts, 0); assert.equal(f.held.get('default'), 0);
});
test('a reboot retaining the same Live is rejected by the finite task original boot pin before UID execution', async t => {
  const f = await ready(t);
  f.state.resolutionHook = async () => { f.state.bootId = randomUUID(); };
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'));
  assert.equal(f.state.taskCalls, 0); assert.equal(f.state.starts, 0); assert.equal(f.held.get('default'), 0);
});
test('explicit directory migration is required and never replaced by a Root mkdir or chown fallback', async t => {
  const f = await ready(t); f.state.migrationRequired = true;
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), (error: any) => error.code === 'PROJECT_DIRECTORY_MIGRATION_REQUIRED');
  assert.equal(f.state.taskCalls, 0); assert.equal(f.state.starts, 0); assert.equal(f.rootLaunches.length, 0);
  assert.ok(!f.commands.some(command => /mkdir|chown|--version|--mode validate/.test(command)));
});
test('the protected payload bound is checked before any native version task or service launch', async t => {
  const f = await ready(t);
  await f.workspaces.save(f.id, { environment: Object.fromEntries(Array.from({ length: 20 }, (_, n) => ['VALUE_' + n, 'x'.repeat(4096)])) });
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), (error: any) => error.status === 413);
  assert.equal(f.state.taskCalls, 0); assert.equal(f.rootLaunches.length, 0); assert.equal(f.held.get('default'), 0);
});
test('finite task output is bounded before caching a version or issuing a sidecar', async t => {
  const f = await ready(t); f.state.taskOutput = 'x'.repeat(1024 * 1024 + 1);
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), (error: any) => error.code === 'PROJECT_IDENTITY_RESULT_INVALID');
  assert.equal(f.state.starts, 0); assert.equal((await f.read()).probes.length, 0);
  assert.equal((await f.read()).tasks.length, 0); assert.equal(f.held.get('default'), 0);
});
test('private version output and unusable-binary errors are redacted before persistence and API return', async t => {
  const f = await ready(t), secret = 'mesh-secret-value-123';
  await f.workspaces.save(f.id, { secrets: { TOKEN: 'mesh-token' } });
  f.workspaces.resolveProject = async (_id, project) => originalScope({ ...project, environment: { TOKEN: secret } }, project._workspace || 'default');
  f.state.taskOutput = 'envoy version ' + secret;
  const view = await f.mesh.action(f.id, { mode: 'status' }, 'check');
  assert.ok(!JSON.stringify(view).includes(secret)); assert.ok(!(await readFile(f.file, 'utf8')).includes(secret));
  f.state.usable = false; f.state.taskStderr = 'incompatible ' + secret;
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), (error: any) => !String(error).includes(secret));
  assert.ok(!(await readFile(f.file, 'utf8')).includes(secret));
});

for (const field of ['listenerChanged', 'configChanged', 'nativeChanged'] as const)
  test('readonly status rejects a changed ' + field + ' without adopting it or rewriting the original run', async t => {
    const f = await running(t), before = await readFile(f.file, 'utf8'), tasks = f.state.taskCalls;
    f.state[field] = true; const view = await f.mesh.status(f.id);
    assert.equal(view.sidecarRunning, true); assert.equal(view.bindingValid, false); assert.equal(view.ready, false);
    assert.equal(f.state.taskCalls, tasks); assert.equal(await readFile(f.file, 'utf8'), before);
  });
test('an Envoy orphan is retained until the original complete domain, including detached descendants, is stopped', async t => {
  const f = await running(t); f.running.get('default')!.orphan = true;
  assert.equal((await f.mesh.status(f.id)).bindingValid, false);
  const row = (await f.read()).runs[0], runId = row.execution.record.runId;
  assert.deepEqual([...f.members.get(runId)!], [1234, 5555, 5556]);
  await f.mesh.action(f.id, { mode: 'stop' }, 'run');
  assert.equal(f.members.has(runId), false); assert.equal(f.tickets.get(runId)!.phase, 'closed');
  assert.equal((await f.read()).runs.length, 0);
});
test('host reload reads full original tickets and keeps persistent sidecars without new tasks or launches', async t => {
  const f = await running(t), before = await readFile(f.file, 'utf8'), tasks = f.state.taskCalls, launches = f.state.starts;
  await f.restart(); const view = await f.mesh.status(f.id);
  assert.equal(view.bindingValid, true); assert.equal(f.state.taskCalls, tasks); assert.equal(f.state.starts, launches);
  assert.equal(await readFile(f.file, 'utf8'), before);
});
test('a new boot cannot reuse the old sidecar label or silently retire the original run', async t => {
  const f = await running(t), row = (await f.read()).runs[0];
  f.state.bootId = randomUUID(); f.state.coldBootBlocked = true;
  const view = await f.mesh.status(f.id); assert.equal(view.sidecarRunning, true); assert.equal(view.bindingValid, false);
  assert.equal((await f.read()).runs[0].execution.record.bootId, row.execution.record.bootId);
  await assert.rejects(f.mesh.action(f.id, { mode: 'stop' }, 'run'), is503);
  assert.equal(f.running.has('default'), true); assert.equal(f.tickets.get(row.execution.record.runId)!.phase, 'active');
  f.state.coldBootBlocked = false; await f.mesh.action(f.id, { mode: 'stop' }, 'run');
  assert.equal((await f.read()).runs.length, 0);
});
test('failed full-domain stop retains the record and fixed configuration and returns 503 until a confirmed retry', async t => {
  const f = await running(t), original = (await f.read()).runs[0]; f.state.cleanupFailures = 1;
  await assert.rejects(f.mesh.action(f.id, { mode: 'stop' }, 'run'), is503);
  assert.equal((await f.read()).runs[0].phase, 'stopping'); assert.equal(f.members.has(original.execution.record.runId), true);
  assert.equal(f.configs.has(original.execution.record.runId), true); assert.equal(f.tickets.get(original.execution.record.runId)!.phase, 'active');
  await f.mesh.action(f.id, { mode: 'stop' }, 'run'); assert.equal((await f.read()).runs.length, 0);
  assert.ok(f.events.indexOf('default:full-domain-absent') < f.events.indexOf('default:config-retired'));
});
test('launch ACK loss and failed rollback retain the pending preparation even before ready listener publication', async t => {
  const f = await ready(t); f.state.launchAckFailures = 1; f.state.cleanupFailures = 1;
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), is503);
  const row = (await f.read()).runs[0];
  assert.equal(row.phase, 'stopping'); assert.equal(row.listener, null); assert.equal(row.execution.record.phase, 'intent');
  assert.equal(f.held.get('default'), 1); assert.equal(f.configs.has(row.execution.record.runId), true);
  assert.equal(f.running.has('default'), true);
  await f.mesh.action(f.id, { mode: 'stop' }, 'run');
  assert.equal(f.held.get('default'), 0); assert.equal((await f.read()).runs.length, 0);
});
test('a lost fixed configuration publication ACK keeps its original receipt until cleanup succeeds', async t => {
  const f = await ready(t); f.state.configFailures = 1; f.state.configCleanupFailures = 1;
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), is503);
  const row = (await f.read()).runs[0]; assert.equal(row.config, null); assert.equal(f.configs.has(row.execution.record.runId), true);
  assert.equal(f.state.starts, 0); assert.equal(f.held.get('default'), 1);
  await f.mesh.action(f.id, { mode: 'stop' }, 'run'); assert.equal(f.configs.size, 0); assert.equal(f.held.get('default'), 0);
});
test('finite validator cleanup failure preserves config and the separate original task ticket, not merely the service intent', async t => {
  const f = await ready(t); f.state.taskFailOnCall = 2;
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), is503);
  const saved = await f.read(), row = saved.runs[0], task = saved.tasks[0];
  assert.equal(task.owner.kind, 'task'); assert.equal(task.identity.identityId, row.execution.identity.identityId);
  assert.notEqual(task.owner.runId, row.execution.record.runId); assert.equal(f.finiteMembers.has(task.owner.runId), true);
  assert.equal(f.configs.has(row.execution.record.runId), true); assert.equal(f.state.starts, 0); assert.equal(f.held.get('default'), 1);
  await assert.rejects(f.mesh.action(f.id, { mode: 'stop' }, 'run'), is503); assert.equal(f.configs.size, 1);
  f.finiteMembers.clear(); await f.mesh.action(f.id, { mode: 'stop' }, 'run');
  assert.equal((await f.read()).tasks.length, 0); assert.equal((await f.read()).runs.length, 0);
  assert.equal(f.configs.size, 0); assert.equal(f.held.get('default'), 0);
});
test('a failed version task retains its preparation and durable task ticket before any long-running service intent exists', async t => {
  const f = await ready(t); f.state.taskCleanupFailures = 1;
  await assert.rejects(f.mesh.action(f.id, { mode: 'status' }, 'check'), is503);
  const saved = await f.read(); assert.equal(saved.runs.length, 0); assert.equal(saved.tasks.length, 1);
  assert.equal(f.held.get('default'), 1); assert.equal((await f.mesh.status(f.id)).ready, false);
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), /先停止/);
  f.finiteMembers.clear(); await f.mesh.action(f.id, { mode: 'stop' }, 'run');
  assert.equal((await f.read()).tasks.length, 0); assert.equal(f.held.get('default'), 0);
});
test('a changed finite-task host receipt cannot authorize retirement or configuration deletion', async t => {
  const f = await ready(t); f.state.taskFailOnCall = 2;
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), is503);
  const task = (await f.read()).tasks[0], ticket = f.finiteTickets.get(task.owner.runId)!;
  f.finiteMembers.clear(); const sha256 = ticket.sha256; ticket.sha256 = 'e'.repeat(64);
  await assert.rejects(f.mesh.action(f.id, { mode: 'stop' }, 'run'), is503); assert.equal(f.configs.size, 1);
  assert.equal((await f.read()).tasks.length, 1); ticket.sha256 = sha256;
  await f.mesh.action(f.id, { mode: 'stop' }, 'run'); assert.equal(f.held.get('default'), 0);
});
test('preparation release failures remain 503 and retain a retryable original run after confirmed process cleanup', async t => {
  const f = await ready(t); f.state.releaseFailures = 2;
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), is503);
  assert.equal(f.running.size, 0); assert.equal(f.members.size, 0); assert.equal((await f.read()).runs[0].phase, 'stopping');
  assert.equal(f.held.get('default'), 1);
  await f.mesh.action(f.id, { mode: 'stop' }, 'run'); assert.equal(f.held.get('default'), 0); assert.equal((await f.read()).runs.length, 0);
});
test('abort preserves the cancellation result after the original finite task fully cleans up, with no Root fallback', async t => {
  const f = await ready(t), controller = new AbortController(); f.state.taskHook = async () => controller.abort();
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run', controller.signal), (error: any) => error.name === 'AbortError');
  assert.equal(f.state.starts, 0); assert.equal(f.held.get('default'), 0); assert.equal(f.finiteMembers.size, 0);
  assert.equal((await f.read()).tasks.length, 0); assert.equal(f.rootLaunches.length, 0);
});
test('legacy root or unknown scoped processes are reported for administrator review and never stopped or adopted', async t => {
  const f = await ready(t); f.state.legacyRunning.add('default');
  const current = await f.mesh.status(f.id); assert.equal(current.sidecarRunning, true); assert.equal(current.ready, false);
  assert.match(current.reason!, /root|未知/); await assert.rejects(f.mesh.action(f.id, { mode: 'stop' }, 'run'), /管理员/);
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), /管理员/);
  assert.equal(f.state.legacyRunning.has('default'), true); assert.equal(f.state.taskCalls, 0);
  f.state.legacyRunning.clear(); f.state.unknownScope = true;
  await assert.rejects(f.mesh.action(f.id, { mode: 'stop' }, 'run'), /管理员/); assert.equal(f.state.starts, 0);
});
test('environment changes mark the old process unready but explicit stop uses only its original protected config and ticket', async t => {
  const f = await running(t), row = (await f.read()).runs[0];
  await f.workspaces.save(f.id, { environment: { CHANGED_ENV: 'new' } });
  assert.equal((await f.mesh.status(f.id)).bindingValid, false);
  f.state.resolutionHook = async () => { throw new Error('stop cannot resolve replacement config/environment'); };
  const resolutions = f.state.resolutions; await f.mesh.action(f.id, { mode: 'stop' }, 'run');
  assert.equal(f.state.resolutions, resolutions); assert.equal(f.tickets.get(row.execution.record.runId)!.phase, 'closed');
});
test('externally changed host metadata is not overwritten from a stale in-memory facade', async t => {
  const f = await running(t), saved = await f.read();
  saved.probes[0].version = 'external administrator sample'; const external = JSON.stringify(saved);
  await writeFile(f.file, external); await assert.rejects(f.mesh.status(f.id));
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run')); assert.equal(await readFile(f.file, 'utf8'), external);
});
test('Mesh owns a distinct namespace and receipt while reusing only the existing service domain policy', async t => {
  const f = await ready(t), project = await f.workspaces.config(f.id), scope = new ProjectMeshScope(f.machines, f.id, project);
  const paths = projectMeshScopePaths(project);
  assert.equal(paths.guest, '/run/sakura-project-mesh/default'); assert.equal(paths.session, 'sakura-mesh-uid-default');
  assert.notEqual(paths.guest, projectServiceScopePaths(project, 'mesh').guest);
  assert.notEqual(paths.guest, projectNotebookScopePaths(project).guest);
  assert.notEqual(paths.guest, projectReverseTunnelScopePaths(project).guest);
  assert.match(scope.receipt().replaceAll('\\', '/'), /project-mesh\/default\/runtime.json$/);
  const intent = scope.newIntent('a'.repeat(64), f.state.bootId); assert.equal(intent.scopeName, 'sakura-service-' + intent.runId);
  assert.equal(projectMeshRecordSchema.safeParse({ ...intent, session: 'sakura-service-mesh' }).success, false);
});
test('a full Mesh ticket refuses a substituted account, original config digest or listener port', async t => {
  const f = await running(t), row = (await f.read()).runs[0]; assert.equal(meshRunSchema.safeParse(row).success, true);
  assert.equal(meshRunSchema.safeParse({ ...row, plan: { ...row.plan, uid: row.plan.uid + 1 } }).success, false);
  assert.equal(meshRunSchema.safeParse({ ...row, config: { ...row.config, sha256: 'c'.repeat(64) } }).success, false);
  assert.equal(meshRunSchema.safeParse({ ...row, listener: { ...row.listener, port: 9999 } }).success, false);
});
test('Root config metadata uses bounded stdin frames and a fixed command while all project execution remains in UID frames', async t => {
  const f = await running(t), row = (await f.read()).runs[0], project = await f.workspaces.config(f.id);
  const source = JSON.stringify(envoySidecarConfig(policy));
  const plan = meshConfigPlan(row.execution.identity, row.execution.record, source, { ...policy, updatedAt: 'ignored' } as any);
  assert.equal('name' in plan, false); assert.equal('updatedAt' in plan, false);
  assert.equal(plan.sha256, createHash('sha256').update(source).digest('hex'));
  const inspect = meshInspectInput(project), publish = meshConfigInput('publish', plan, null, source),
    probe = meshProcessInput(plan, row.config, row.binary, row.execution.identity, row.execution.run, row.listener);
  for (const frame of [inspect, publish, probe]) {
    assert.equal(frame.subarray(0, 8).toString(), 'SKMESH01'); assert.ok(frame.readUInt32LE(8) <= 8192);
  }
  assert.ok(!meshControlCommand.includes(project.directory)); assert.ok(!meshControlCommand.includes(row.execution.identity.identityId));
  assert.ok(!meshControlCommand.includes('os.execv')); assert.match(meshControlCommand, /HOME=\/ /);
  assert.match(meshEnvoyExecution(row.binary, row.config), /os.execv/);
  const config = meshConfigSchema.parse(row.config); assert.equal(config.gid, row.execution.identity.gid);
  assert.equal(f.frames[0].readUInt32LE(12), 0); assert.equal(f.frames[0].subarray(0, 8).toString(), 'SKIDP001');
});
