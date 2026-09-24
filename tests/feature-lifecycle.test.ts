import { PLUGINS } from '../shared/plugins.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines } from '../server/machines.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-feature-lifecycle-'));
process.env.SAKURA_DATA_DIR = root;
const { Features } = await import('../server/features.ts');
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
  const commands: string[] = [];
  machines.live.set(id, {} as any);
  machines.exec = async (_vmId: string, command: string) => {
    commands.push(command);
    return { stdout: '', stderr: '', code: 0 };
  };
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
    assert.ok(commands.some((command) => command.includes('/workspace/selected')));
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
  features.bundles.import = async (_name, _source, currentSignal) => {
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
  features.bundles.import = async () => ({ id: 'new-vm' }) as any;
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
