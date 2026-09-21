import test from 'node:test';
import assert from 'node:assert/strict';
import { executeProjectAction } from '../src/project-action.ts';
import type { VMView } from '../server/model.ts';
import type { Project } from '../server/workspaces.ts';
import type { Request } from '../src/FeaturePanels.tsx';

const vm = { id: 'test-vm', status: 'running' } as VMView;
const project: Project = {
  template: 'node',
  directory: '/workspace',
  repository: '',
  setup: 'npm install',
  command: 'npm start',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const boundary of ['boot', 'installation', 'refresh', 'save'] as const) {
  test(`leaving the project during ${boundary} cannot submit later configuration or start a job`, async () => {
    const abort = new AbortController();
    const reached = deferred<void>();
    const response = deferred<unknown>();
    const calls: string[] = [];
    const request: Request = async <T>(
      path: string,
      method = 'GET',
      _body?: unknown,
      signal?: AbortSignal,
    ) => {
      assert.equal(signal, abort.signal);
      calls.push(`${method} ${path}`);
      if (
        (boundary === 'boot' && path === '/vms/test-vm') ||
        (boundary === 'installation' && path.endsWith('/project') && method === 'GET') ||
        (boundary === 'save' && method === 'PUT')
      ) {
        reached.resolve();
        // Deliberately ignore cancellation here to model a response already
        // queued when the effect cleanup aborts the request.
        return (await response.promise) as T;
      }
      return (path === '/vms/test-vm' ? vm : { job: null }) as T;
    };
    const running = executeProjectAction({
      request,
      vm: { ...vm, status: 'stopped' },
      project,
      kind: 'start',
      signal: abort.signal,
      refresh: async () => {
        calls.push('refresh');
        if (boundary === 'refresh') {
          reached.resolve();
          await response.promise;
        }
      },
    });
    await reached.promise;
    abort.abort();
    response.resolve(boundary === 'boot' ? vm : { job: null });
    await assert.rejects(running, { name: 'AbortError' });
    assert.ok(!calls.includes('POST /vms/test-vm/project'), 'no new job is started');
    if (boundary !== 'save')
      assert.ok(!calls.includes('PUT /vms/test-vm/project'), 'old draft is never written');
    if (boundary === 'boot') assert.ok(!calls.includes('refresh'));
    if (boundary === 'refresh') assert.ok(!calls.includes('GET /vms/test-vm/project'));
  });
}

for (const phase of ['boot', 'installation'] as const) {
  test(`cancelling the ${phase} polling delay stops immediately and releases its timer`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const abort = new AbortController();
    const calls: string[] = [];
    const reached = deferred<void>();
    const request: Request = async <T>(path: string, method = 'GET') => {
      calls.push(`${method} ${path}`);
      if (phase === 'boot' && path === '/vms/test-vm') {
        reached.resolve();
        return { status: 'starting' } as T;
      }
      if (phase === 'installation' && path.endsWith('/project')) {
        reached.resolve();
        return { job: { status: 'running' } } as T;
      }
      return vm as T;
    };
    const running = executeProjectAction({
      request,
      vm,
      project,
      kind: 'start',
      signal: abort.signal,
      refresh: async () => {},
    });
    await reached.promise;
    await Promise.resolve();
    abort.abort();
    await assert.rejects(running, { name: 'AbortError' });
    const count = calls.length;
    t.mock.timers.tick(1200000);
    assert.equal(calls.length, count);
    assert.ok(calls.every((call) => call.startsWith('GET ')));
  });
}

test('an active project action waits for boot and installation before saving and starting', async () => {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const abort = new AbortController();
  const request: Request = async <T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) => {
    assert.equal(signal, abort.signal);
    calls.push({ path, method, body });
    return (path === '/vms/test-vm' ? vm : { job: null }) as T;
  };
  await executeProjectAction({
    request,
    vm: { ...vm, status: 'stopped' },
    project,
    kind: 'start',
    signal: abort.signal,
    refresh: async () => {
      calls.push({ path: 'refresh', method: '' });
    },
  });
  assert.deepEqual(
    calls.map(({ method, path }) => `${method} ${path}`),
    [
      'POST /vms/test-vm/start',
      'GET /vms/test-vm',
      ' refresh',
      'GET /vms/test-vm/project',
      'PUT /vms/test-vm/project',
      'POST /vms/test-vm/project',
    ],
  );
  assert.equal(calls[4].body, project);
  assert.deepEqual(calls[5].body, { action: 'start' });
});
