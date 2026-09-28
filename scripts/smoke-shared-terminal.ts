import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ClientChannel } from 'ssh2';

const root = await mkdtemp(join(tmpdir(), 'sakura-shared-terminal-'));
const imageDir = join(root, 'images');
await mkdir(imageDir);
await copyFile(resolve('.data/images/alpine-3.23.qcow2'), join(imageDir, 'alpine-3.23.qcow2'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_PATH = join(imageDir, 'alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { TerminalSharing } = await import('../server/terminal-sharing.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const sharing = new TerminalSharing(machines, join(root, 'terminal-sharing.json'));
await sharing.init();
try {
  const vm = await machines.create({ name: 'terminal-share-smoke', memoryMiB: 1024,
    cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const until = Date.now() + 300_000;
  while (machines.state(vm.id) !== 'running') {
    if (['error', 'stopped'].includes(machines.state(vm.id)) || Date.now() > until)
      throw new Error(machines.logs.get(vm.id) || '客户机启动超时');
    await delay(250);
  }
  const installed = await machines.exec(vm.id, 'command -v tmux >/dev/null');
  if (installed.code !== 0) {
    const install = await machines.exec(vm.id, 'apk add --no-cache tmux', 120_000);
    assert.equal(install.code, 0, install.stderr);
  }
  const session = 'share-test';
  const target = '=sakura-terminal-' + session;
  const created = await machines.exec(vm.id, `tmux new-session -d -s sakura-terminal-${session}`);
  assert.equal(created.code, 0, created.stderr);
  const viewerId = '00000000-0000-4000-8000-000000000002';
  const grant = await sharing.create({ vmId: vm.id, viewerId, session, minutes: 5 });
  assert.equal(sharing.find(viewerId, vm.id, session)?.id, grant.id);
  const client = await machines.connect(vm.id);
  try {
    const stream = await new Promise<ClientChannel>((done, fail) => client.exec(
      `exec tmux attach-session -r -t ${target}`,
      { pty: { term: 'xterm-256color', cols: 100, rows: 28 } },
      (error, channel) => error ? fail(error) : done(channel)));
    let output = '';
    stream.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    await delay(500);
    const sent = await machines.exec(vm.id,
      `tmux send-keys -t ${target}:0 'printf shared-terminal-live' Enter`);
    assert.equal(sent.code, 0, sent.stderr);
    const outputDeadline = Date.now() + 10_000;
    while (!output.includes('shared-terminal-live') && Date.now() < outputDeadline)
      await delay(100);
    assert.match(output, /shared-terminal-live/);
    stream.write('touch /tmp/readonly-terminal-violation\n');
    await delay(500);
    assert.equal((await machines.exec(vm.id,
      'test ! -e /tmp/readonly-terminal-violation')).code, 0);
    stream.close();
  } finally { client.end(); }
  await sharing.revoke(grant.id);
  assert.equal(sharing.find(viewerId, vm.id, session), null);
  console.log('Live tmux read-only attachment, output, blocked input and grant revocation passed');
} finally {
  await sharing.close();
  await machines.close();
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(root, /sakura-shared-terminal-/);
  await rm(root, { recursive: true, force: true });
}
