import { PLUGINS } from '../shared/plugins.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { FeatureDevTaskOptions } from '../server/feature-suite-dev-task.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-feature-lifecycle-'));
process.env.SAKURA_DATA_DIR = root;
const { Features } = await import('../server/features.ts');
const { MAX_TEXT_REQUEST_BYTES } = await import('../server/http.ts');
const { projectVersion } = await import('../server/workspaces.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-feature-lifecycle-'));
  await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const machines = Object.assign(new EventEmitter(), {
    records: new Map(),
    live: new Map(),
    get: () => ({ name: 'vm' }),
    state: () => 'running',
    locked: async (_key: string, work: () => Promise<unknown>) => work(),
  }) as unknown as Machines;
  const features = await Features.create(
    machines,
    PLUGINS.map((item) => item.id),
  );
  const req = Object.assign(new EventEmitter(), { method: 'POST', headers: {} }) as IncomingMessage;
  const res = Object.assign(new EventEmitter(), {
    writableFinished: false,
    writeHead: () => {},
    end() {
      this.writableFinished = true;
    },
  }) as unknown as ServerResponse;
  return { features, machines, req, res };
}

test('sync accepts manual text through the authorized body callback with its larger limit', async () => {
  const { features, req, res } = await fixture();
  let limit: number | undefined;
  let signal: AbortSignal | undefined;
  try {
    await assert.rejects(features.route(
      req, res,
      new URL('http://localhost/api/vms/22222222-2222-4222-8222-222222222222/sync'),
      async (_request, requestSignal, requestLimit) => {
        signal = requestSignal;
        limit = requestLimit;
        return { direction: 'both' };
      },
    ), /请先保存同步目录/);
    assert.equal(limit, MAX_TEXT_REQUEST_BYTES);
    assert.ok(signal instanceof AbortSignal);
  } finally {
    await features.close();
  }
});

test('scoped feature endpoints hand the selected project through to views and jobs', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const projectId = '0123456789abcdef';
  const directory = join(root, 'machines', id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'projects.json'),
    JSON.stringify({
      active: 'default',
      projects: [
        { id: 'default', name: '默认项目' },
        { id: projectId, name: 'Selected project' },
      ],
    }),
  );
  await writeFile(
    join(directory, `project-${projectId}.json`),
    JSON.stringify({ directory: '/workspace/selected', template: 'none' }),
  );
  const { features, machines } = await fixture();
  const executedProjects: { projectId: string; directory: string }[] = [];
  let releases = 0;
  machines.live.set(id, {} as any);
  machines.exec = async () => {
    return { stdout: '', stderr: '', code: 0 };
  };
  const devTaskOptions: FeatureDevTaskOptions = {
    terminals: {
      prepare: async (vmId, scope, session, readOnly, signal, _terminal, mode) => {
        assert.equal(vmId, id);
        assert.equal(scope, projectId);
        assert.equal(session, null);
        assert.equal(readOnly, false);
        assert.deepEqual(mode, { mode: 'task' });
        const project = await features.workspaces.config(id);
        return { command: 'unused', projectId: scope, networkIsolation: project.networkIsolation || 'host',
          signal: signal!, terminalId: undefined,
          captured: { project, configVersion: projectVersion(project), live: machines.live.get(id)! },
          release: () => { ++releases; } };
      },
    },
    runTask: async (_machines, vmId, project, execution, signal) => {
      assert.equal(vmId, id);
      assert.equal(features.workspaces.projects.current(id), projectId);
      assert.equal(signal.aborted, false);
      assert.match(execution.command, /npm test/);
      executedProjects.push({ projectId: project._workspace!, directory: project.directory });
      return { stdout: '', stderr: '', code: 0 };
    },
  };
  Reflect.set(features.suite, 'devTaskOptions', devTaskOptions);
  const request = Object.assign(new EventEmitter(), { method: 'GET', headers: {} }) as IncomingMessage;
  const response = () =>
    Object.assign(new EventEmitter(), {
      writableFinished: false,
      status: 0,
      payload: undefined as unknown,
      writeHead(status: number) {
        this.status = status;
      },
      end(value: string) {
        this.payload = JSON.parse(value);
        this.writableFinished = true;
      },
    }) as unknown as ServerResponse & {
      status: number;
      payload: { projectId: string; key?: string; status?: string };
    };
  const viewResponse = response();
  try {
    assert.equal(
      await features.route(
        request,
        viewResponse,
        new URL(`http://localhost/api/vms/${id}/advanced?project=${projectId}`),
        async () => undefined,
      ),
      true,
    );
    assert.equal(viewResponse.status, 200);
    assert.equal(viewResponse.payload.projectId, projectId);

    request.method = 'POST';
    const jobResponse = response();
    assert.equal(
      await features.route(
        request,
        jobResponse,
        new URL(`http://localhost/api/vms/${id}/advanced?project=${projectId}`),
        async () => ({ action: 'dev', operation: 'test' }),
      ),
      true,
    );
    assert.equal(jobResponse.status, 202);
    assert.equal(jobResponse.payload.projectId, projectId);
    assert.equal(jobResponse.payload.key, `${id}:${projectId}:dev`);
    await features.suite.jobs.wait(jobResponse.payload.key);
    assert.equal(features.suite.jobs.view(jobResponse.payload.key)?.status, 'done');
    assert.deepEqual(executedProjects, [{ projectId, directory: '/workspace/selected' }]);
    assert.equal(releases, 1);
  } finally {
    await features.close();
  }
});

test('disconnect cancels an active import and permits a new import after cleanup', async () => {
  const { features, req, res } = await fixture();
  let signal: AbortSignal | undefined;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  features.bundles.importExternal = async (_name, _source, currentSignal) => {
    signal = currentSignal;
    started();
    await new Promise<void>((resolve) => {
      currentSignal?.addEventListener('abort', () => resolve(), { once: true });
    });
    currentSignal?.throwIfAborted();
    throw new Error('Expected cancellation');
  };
  const pending = features.route(
    req,
    res,
    new URL('http://localhost/api/import?name=example'),
    async () => ({}),
  );
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await began;
  res.emit('close');
  assert.equal(signal?.aborted, true);
  await rejected;
  assert.equal(res.listenerCount('close'), 0);
  features.bundles.importExternal = async () => ({ id: 'new-vm' }) as any;
  assert.equal(
    await features.route(req, res, new URL('http://localhost/api/import?name=retry'), async () => ({})),
    true,
  );
  await features.close();
});

test('shutdown waits for request cleanup and rejects new feature operations', async () => {
  const { features, req, res } = await fixture();
  let release!: () => void;
  let started!: () => void;
  let signal: AbortSignal | undefined;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  features.bundles.clone = async (_id, _name, _snapshot, currentSignal) => {
    signal = currentSignal;
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    currentSignal?.throwIfAborted();
    return {} as any;
  };
  const pending = features.route(req, res, new URL('http://localhost/api/vms/vm/clone'), async () => ({
    name: 'copy',
  }));
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await began;
  let finished = false;
  const closing = features.close().then(() => {
    finished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signal?.aborted, true);
  assert.equal(finished, false);
  await assert.rejects(
    features.route(req, res, new URL('http://localhost/api/images'), async () => ({})),
    /关闭/,
  );
  release();
  await rejected;
  await closing;
  assert.equal(finished, true);
});

test('shutdown also waits for in-flight read operations before releasing the runtime', async () => {
  const { features, req, res } = await fixture();
  req.method = 'GET';
  let started!: () => void;
  let release!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  features.workspaces.runtime = async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { status: 'running', log: '' };
  };
  const pending = features.route(
    req,
    res,
    new URL('http://localhost/api/vms/vm/project-runtime'),
    async () => ({}),
  );
  await began;
  let finished = false;
  const closing = features.close().then(() => {
    finished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  release();
  await pending;
  await closing;
  assert.equal(res.listenerCount('close'), 0);
});
