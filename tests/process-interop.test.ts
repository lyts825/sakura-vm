import assert from 'node:assert/strict';
import { appendFile, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import type { Machines } from '../server/machines.ts';

test('Windows process interop permits only registered, unchanged EXEs from an installed guest',
  { skip: process.platform !== 'win32' }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sakura-process-interop-'));
    const previous = process.env.SAKURA_DATA_DIR;
    process.env.SAKURA_DATA_DIR = directory;
    try {
      const { ProcessInterop } = await import('../server/process-interop.ts');
      const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const executable = join(directory, 'node.exe');
      await copyFile(process.execPath, executable);
      const files = new Map<string, string>();
      const machines = {
        get: (value: string) => { assert.equal(value, id); return { id }; },
        requireUnlocked: (value: string) => assert.equal(value, id),
        state: (value: string) => { assert.equal(value, id); return 'running'; },
        exec: async (_id: string, _command: string) => ({ code: 0, stdout: '', stderr: '' }),
        writeGuestFile: async (_id: string, path: string, content: string) => {
          files.set(path, content);
        },
      } as unknown as Machines;
      const interop = new ProcessInterop(machines, 7337);
      const allow = { mode: 'allow', programId: 'node', executable,
        fixedArgs: ['-e', 'process.stdout.write("interop-ok")'] };
      const checked = await interop.action(id, allow, 'check');
      assert.equal(checked.executed, false);
      const empty = await interop.action(id, { mode: 'status' }, 'check');
      assert.ok('programs' in empty);
      assert.deepEqual(empty.programs, []);
      await interop.action(id, allow, 'run');
      const status = await interop.action(id, { mode: 'status' }, 'check');
      assert.ok('programs' in status);
      assert.equal(status.programs.length, 1);
      await interop.action(id, { mode: 'install' }, 'run');
      const config = files.get('/etc/sakura/interop.curl') || '';
      const token = /X-Sakura-Guest-Token: ([a-f0-9]{64})/.exec(config)?.[1];
      assert.ok(token);
      assert.equal(config.includes('interop-ok'), false);
      assert.equal(files.get('/usr/local/bin/sakura-win')?.includes(token), false);
      await assert.rejects(interop.guest({ vmId: id, programId: 'node' }, 'wrong'), /未授权/);
      await assert.rejects(interop.guest({ vmId: id, programId: 'other' }, token), /未获准/);
      const result = await interop.guest({ vmId: id, programId: 'node' }, token);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, 'interop-ok');
      const reloaded = new ProcessInterop(machines, 7337);
      assert.equal((await reloaded.guest({ vmId: id, programId: 'node' }, token)).exitCode, 0);
      await appendFile(executable, 'changed');
      await assert.rejects(reloaded.guest({ vmId: id, programId: 'node' }, token), /已改变/);
      await interop.action(id, { mode: 'disable' }, 'run');
      await assert.rejects(interop.guest({ vmId: id, programId: 'node' }, token), /未授权/);
    } finally {
      if (previous === undefined) delete process.env.SAKURA_DATA_DIR;
      else process.env.SAKURA_DATA_DIR = previous;
      assert.equal(dirname(directory), resolve(tmpdir()));
      assert.ok(basename(directory).startsWith('sakura-process-interop-'));
      await rm(directory, { recursive: true, force: true });
    }
  });
