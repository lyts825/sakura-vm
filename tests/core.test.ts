import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createSchema, checkedId, guestPath } from '../server/model.ts';
import { seedIso, createSshKey, userData } from '../server/seed.ts';
import { sameOrigin, tokenMatches } from '../server/security.ts';
import { qmp } from '../server/qmp.ts';
import ssh2 from 'ssh2';
const { utils } = ssh2;

test('configuration rejects traversal, command injection, invalid limits and duplicate ports', () => {
  for (const name of ['../disk', 'a;rm', 'a b', '-accel', 'C:\\disk', 'A'])
    assert.equal(createSchema.safeParse({ name }).success, false);
  for (const patch of [
    { cpus: 0 },
    { cpus: 9 },
    { cpus: 1.5 },
    { memoryMiB: 128 },
    { memoryMiB: Infinity },
    { diskGiB: 1 },
    { accelerator: 'shell' },
    { executable: 'powershell' },
    {
      forwards: [
        { host: 8080, guest: 80 },
        { host: 8080, guest: 22 },
      ],
    },
  ])
    assert.equal(createSchema.safeParse({ name: 'alpine', ...patch }).success, false);
  assert.deepEqual(createSchema.parse({ name: 'alpine' }), {
    name: 'alpine',
    cpus: 2,
    memoryMiB: 512,
    diskGiB: 8,
    accelerator: 'auto',
    forwards: [],
  });
});
test('host, origin, fetch-site and token gate reject rebinding and cross-origin requests', () => {
  assert.equal(sameOrigin({ host: '127.0.0.1:7337', origin: 'http://127.0.0.1:7337' }, 7337), true);
  assert.equal(sameOrigin({ host: 'localhost:7337' }, 7337), true);
  for (const headers of [
    { host: 'evil.example:7337' },
    { host: '127.0.0.1:7337', origin: 'http://evil.example' },
    { host: '127.0.0.1:7337', origin: 'null' },
    { host: '127.0.0.1:7337', 'sec-fetch-site': 'cross-site' },
    { host: '127.0.0.1:7338' },
  ])
    assert.equal(sameOrigin(headers, 7337), false);
  assert.equal(tokenMatches('abc', 'abc'), true);
  for (const input of [undefined, ['abc'], 'ab', 'abd']) assert.equal(tokenMatches(input, 'abc'), false);
});
test('managed disk paths accept only UUIDs and guest paths cannot contain protocol control bytes', () => {
  assert.equal(checkedId('92688083-ff25-d98f-4419-4356f9ec93df'), '92688083-ff25-d98f-4419-4356f9ec93df');
  for (const id of ['../../', '92688083----------------------------', 'C:\\', ''])
    assert.throws(() => checkedId(id));
  for (const path of ['relative', '/tmp/\0file', '/tmp/\nfile', null]) assert.throws(() => guestPath(path));
  assert.equal(guestPath('/workspace/中文.txt'), '/workspace/中文.txt');
});
test('NoCloud ISO directory extents point to the actual UTF-8 bootstrap files', () => {
  const files = { 'meta-data': 'instance-id: test\n', 'user-data': '#!/bin/sh\nprintf 你好\n' };
  const image = seedIso(files),
    pvd = image.subarray(16 * 2048);
  assert.equal(pvd.toString('ascii', 1, 6), 'CD001');
  assert.equal(pvd.toString('ascii', 40, 72).trim(), 'CIDATA');
  assert.equal(pvd.readUInt32LE(80) * 2048, image.length);
  let at = 20 * 2048;
  const recovered: Record<string, string> = {};
  while (image[at]) {
    const length = image[at];
    const name = image.toString('ascii', at + 33, at + 33 + image[at + 32]);
    if (name.includes(';1'))
      recovered[name.split('.;')[0].toLowerCase()] = image.toString(
        'utf8',
        image.readUInt32LE(at + 2) * 2048,
        image.readUInt32LE(at + 2) * 2048 + image.readUInt32LE(at + 10),
      );
    at += length;
  }
  assert.deepEqual(recovered, files);
});
test('per-instance SSH keys match and bootstrap never enables password login', () => {
  const pair = createSshKey();
  const privateKey = utils.parseKey(pair.privateText);
  const publicKey = utils.parseKey(pair.publicText);
  assert.ok(!(privateKey instanceof Error));
  assert.ok(!(publicKey instanceof Error));
  if (
    !(privateKey instanceof Error) &&
    !(publicKey instanceof Error) &&
    !Array.isArray(privateKey) &&
    !Array.isArray(publicKey)
  )
    assert.deepEqual(privateKey.getPublicSSH(), publicKey.getPublicSSH());
  const script = userData('alpine', pair.publicText);
  assert.match(script, /PasswordAuthentication no/);
  assert.ok(!script.includes(pair.privateText));
});
test('QMP handles fragmented greeting, capabilities, async events and command errors', async () => {
  const server = createServer((socket) => {
    socket.write('{"QMP":');
    setImmediate(() => socket.write('{"version":{}}}\r\n'));
    let input = '';
    socket.on('data', (data) => {
      input += data;
      let at;
      while ((at = input.indexOf('\n')) >= 0) {
        const msg = JSON.parse(input.slice(0, at));
        input = input.slice(at + 1);
        socket.write(JSON.stringify({ event: 'RESUME' }) + '\n');
        socket.write(
          JSON.stringify(
            msg.execute === 'qmp_capabilities'
              ? { return: {}, id: msg.id }
              : { error: { desc: 'not supported' }, id: msg.id },
          ) + '\n',
        );
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await assert.rejects(qmp((server.address() as { port: number }).port, 'invalid'), /not supported/);
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
  }
});
