import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** A real compiled controller with test-owned state; never uses the user's VMs. */
export async function startTestController() {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-browser-integration-'));
  await writeFile(
    join(directory, 'plugins.json'),
    JSON.stringify({ schemaVersion: 3, plugins: ['sandbox', 'files', 'snapshots'], packs: [] }),
  );
  const listener = createServer();
  await new Promise<void>((done, fail) => listener.listen(0, '127.0.0.1', done).once('error', fail));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((done) => listener.close(() => done()));
  const origin = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined,
    exited: Promise<unknown> | undefined,
    spawnError: Error | undefined,
    token = '',
    output = '';
  const request = async <T = any>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    const response = await fetch(origin + '/api' + path, {
      method,
      headers: { 'x-sakura-token': token, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
    return value;
  };
  const start = async () => {
    output = '';
    spawnError = undefined;
    child = spawn(process.execPath, ['.sakura-server/index.js'], {
      env: {
        ...process.env,
        SAKURA_DATA_DIR: directory,
        SAKURA_PORT: String(port),
        SAKURA_IMAGE_PATH: resolve('.data/images/alpine-3.23.qcow2'),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    exited = new Promise((done) => {
      child!.once('exit', done);
      child!.once('error', (error) => {
        spawnError = error;
        done(error);
      });
    });
    child.stdout!.on('data', (data) => {
      output = (output + data).slice(-16000);
    });
    child.stderr!.on('data', (data) => {
      output = (output + data).slice(-16000);
    });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error('Controller exited: ' + output);
      try {
        const response = await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          token = (await response.json()).token;
          return;
        }
      } catch {}
      await delay(150);
    }
    throw new Error('Controller startup timed out: ' + output);
  };
  const stop = async () => {
    if (!child || spawnError || child.exitCode !== null || child.signalCode !== null) return;
    // Windows process termination cannot rely on SIGTERM handlers. Stop every
    // test-owned guest through the real API before terminating the controller.
    try {
      const vms = await request<{ id: string; poweredOn: boolean }[]>('/vms');
      for (const vm of vms) if (vm.poweredOn) await request(`/vms/${vm.id}/stop`, 'POST', { force: true });
    } finally {
      child.kill('SIGTERM');
      await Promise.race([exited, delay(10000, undefined, { ref: false })]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
  };
  const close = async () => {
    await stop();
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith('sakura-browser-integration-')
    )
      throw new Error('Test directory boundary violation');
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  try {
    await start();
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Controller startup and cleanup failed');
    }
    throw error;
  }
  return {
    origin,
    request,
    restart: async () => {
      await stop();
      await start();
    },
    close,
  };
}
