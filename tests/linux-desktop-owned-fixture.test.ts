import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createCipheriv, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Socket } from 'node:net';
import test from 'node:test';
import ts from 'typescript';
import ssh2 from 'ssh2';
import { WebSocket, WebSocketServer } from 'ws';
import { closeOwnedDesktopSshClient, desktopFixtureLogPath, desktopFixtureParent, LinuxDesktopOwnedFixture, ownedDesktopQemuArguments, ownedDesktopBootstrapTimeout, parseOwnedDesktopBootstrapReply } from '../scripts/linux-desktop-owned-fixture.ts';
import { probeOwnedDesktopRfb } from '../scripts/linux-desktop-rfb-probe.ts';

function admissionParsers() {
  const source = readFileSync(new URL('../scripts/smoke-project-desktop-identity.ts', import.meta.url), 'utf8');
  const start = source.indexOf('function parseOwnedAdmissionServiceReply('), end = source.indexOf('const singleAppFdClassifier =', start);
  assert.ok(start >= 0 && end > start);
  const program = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function('assert', 'Buffer', program + '\nreturn { parseOwnedAdmissionServiceReply, ownedAdmissionRetryRemaining, ownedAdmissionControlAction };')(assert, Buffer);
}

test('ordinary service admission restarts only loaded real fragments and skips only explicit not-found', () => {
  const { parseOwnedAdmissionServiceReply: parse } = admissionParsers();
  const loaded = 'LoadState=loaded\nFragmentPath=/lib/systemd/system/ssh.service\nId=ssh.service\nActiveState=active\nNoNewPrivileges=yes\nMainPID=354\n';
  const absent = 'LoadState=not-found\nFragmentPath=\nId=cron.service\nActiveState=inactive\nNoNewPrivileges=no\nMainPID=0\n';
  assert.equal(parse(loaded, 'ssh.service').restart, true); assert.equal(parse(absent, 'cron.service').restart, false);
  for (const reply of [loaded.replace('LoadState=loaded', 'LoadState=error'), loaded.replace('LoadState=loaded', 'LoadState=masked'),
    loaded.replace('/lib/systemd/system/ssh.service', ''), loaded.replace('/lib/systemd/system/ssh.service', '/lib/../ssh.service'),
    loaded.replace('Id=ssh.service', 'Id=foreign.service'), loaded.replace('MainPID=354', 'MainPID=-1'),
    loaded + 'LoadState=loaded\n', loaded.replace('NoNewPrivileges=yes\n', ''), loaded + 'Unknown=yes\n'])
    assert.throws(() => parse(reply, 'ssh.service'));
  assert.throws(() => parse(absent.replace('FragmentPath=\n', 'FragmentPath=/lib/systemd/system/cron.service\n'), 'cron.service'));
  assert.throws(() => parse(absent.replace('MainPID=0', 'MainPID=345'), 'cron.service'));
  assert.throws(() => parse(loaded, 'foreign.service')); assert.throws(() => parse(' '.repeat(8193), 'ssh.service'));
});

test('post-restart admission bounds only waiting for the original typed refusal and preserves public call timeouts', () => {
  const { ownedAdmissionRetryRemaining: remaining } = admissionParsers();
  const refusal = Object.assign(new Error('original service session still alive'), { code: 'PROJECT_IDENTITY_EGRESS_NNP_RESTART_REQUIRED' });
  assert.equal(remaining(refusal, 30000, 0), 500); assert.equal(remaining(refusal, 30000, 29999), 1);
  for (const error of [new Error('connection lost'), Object.assign(new Error('changed'), { code: 'PROJECT_IDENTITY_EGRESS_TABLE_CHANGED' }),
    { code: refusal.code }, null]) assert.throws(() => remaining(error, 30000, 0), (actual: unknown) => actual === error);
  assert.throws(() => remaining(refusal, 30000, 30000), (actual: unknown) => actual === refusal);
  assert.throws(() => remaining(refusal, 30000, 30001), (actual: unknown) => actual === refusal);
  assert.throws(() => remaining(refusal, Number.NaN, 0), (actual: unknown) => actual === refusal);
  const source = readFileSync(new URL('../scripts/smoke-project-desktop-identity.ts', import.meta.url), 'utf8');
  const retry = source.slice(source.indexOf('const deadline = Date.now() + recovery.retryWaitBudgetMilliseconds;'), source.indexOf('assert.ok(preview.plan);'));
  assert.ok(retry.includes('preview = await migrations.preview(fixture.vmId);'));
  assert.ok(!retry.includes('new AbortController') && !retry.includes('setTimeout') && !retry.includes('Date.now() <= deadline'));
  assert.ok(retry.includes('ownedAdmissionRetryRemaining(retryError, deadline, Date.now())'));
});

test('fixed native observer selects only current Root install ensure inspect and excludes environments and other builds', () => {
  const { ownedAdmissionControlAction: action } = admissionParsers(), build = '1'.repeat(64);
  const command = (request: unknown, selectedBuild = build) => "env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S '/usr/local/lib/sakura-project-identity/" + selectedBuild + "/controller.py' '" + Buffer.from(JSON.stringify(request)).toString('base64') + "'";
  const ensure = { action: 'ensure', projectId: '0123456789abcdef', directory: '/srv/projects/owned', networkIsolation: 'private' };
  assert.equal(action(command({ action: 'install' }), build), 'install');
  assert.equal(action(command({ action: 'inspect', projectId: ensure.projectId }), build), 'inspect');
  assert.equal(action(command(ensure), build), 'ensure'); assert.equal(action(command({ ...ensure, expected: {} }), build), 'ensure');
  for (const request of [{ ...ensure, environment: { SECRET: 'not collected' } }, { action: 'install', environment: {} },
    { action: 'run', projectId: ensure.projectId }, { action: 'inspect', projectId: 'foreign' }, { ...ensure, directory: '/srv/\nsecret' }, null])
    assert.equal(action(command(request), build), null);
  assert.equal(action(command(ensure, '2'.repeat(64)), build), null); assert.equal(action(command(ensure) + '; extra', build), null);
  assert.throws(() => action(command(ensure), 'invalid'));
});

test('pending bootstrap readiness still pins the new DMI and boot and refuses malformed or changed guest replies', () => {
  const vmId = randomUUID(), bootId = randomUUID();
  const pending = { version: 1, kind: 'owned-desktop-bootstrap', dmi: vmId.toUpperCase(), bootId, cloudInitReady: false };
  assert.equal(parseOwnedDesktopBootstrapReply(JSON.stringify(pending), vmId).cloudInitReady, false);
  const ready = parseOwnedDesktopBootstrapReply(JSON.stringify({ ...pending, cloudInitReady: true }), vmId, bootId);
  assert.equal(ready.cloudInitReady, true); assert.equal(ready.dmi, vmId);
  for (const reply of [
    { ...pending, dmi: randomUUID() }, { ...pending, bootId: randomUUID() }, { ...pending, bootId: 'invalid' },
    { ...pending, cloudInitReady: 'false' }, { ...pending, version: 2 }, { ...pending, kind: 'other' },
    { ...pending, extra: null }, { dmi: vmId, bootId, cloudInitReady: true }, null, [],
  ]) assert.throws(() => parseOwnedDesktopBootstrapReply(JSON.stringify(reply), vmId, bootId));
  assert.throws(() => parseOwnedDesktopBootstrapReply('{', vmId));
  assert.throws(() => parseOwnedDesktopBootstrapReply(' '.repeat(1025), vmId));
  for (const remaining of [1, 2, 14999, 15000, 15001, 180000]) {
    const timeout = ownedDesktopBootstrapTimeout(180000, 180000 - remaining);
    assert.ok(timeout > 0 && timeout <= 15000 && timeout <= remaining);
  }
  assert.throws(() => ownedDesktopBootstrapTimeout(180000, 180000));
  assert.throws(() => ownedDesktopBootstrapTimeout(180000, 180001));
  assert.throws(() => ownedDesktopBootstrapTimeout(Number.NaN, 0));
});

test('fixed nft atomic fixture refuses occupied accounts, incomplete objects, changed handles and non-refusal exits', () => {
  const source = readFileSync(new URL('../scripts/smoke-project-desktop-identity.ts', import.meta.url), 'utf8');
  const prefix = 'const nftAtomicFixture = String.raw`', start = source.indexOf(prefix), end = source.indexOf('`;', start + prefix.length);
  assert.ok(start >= 0 && end > start);
  const program = source.slice(start + prefix.length, end); assert.ok(!program.includes('${'));
  const controller = readFileSync(new URL('../native/project-identity/controller.py', import.meta.url), 'utf8');
  // Execute only pure production/fixture parsers. No guest, process, account,
  // namespace or nft transaction runs in this model.
  const model = String.raw`
import ast,sys,json,re,hashlib,base64,copy
input_=json.load(sys.stdin)
names={'UUID','Refusal','refuse','identifier','egress_spec','egress_create_text','egress_json','egress_same_json','egress_objects','egress_table_text'}
def select(source,names):
 tree=ast.parse(source);nodes=[node for node in tree.body if isinstance(node,(ast.FunctionDef,ast.ClassDef)) and node.name in names or isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id in names for target in node.targets)]
 assert len(nodes)==len(names);return ast.Module(body=nodes,type_ignores=[])
ns={'re':re,'json':json};exec(compile(select(input_['controller'],names),'<production-pure-nft>','exec'),ns)
fixture_names={'digest','raw','invalid_third_statement','assert_unused_fixture','snapshot','unchanged','rejected'}
scope={'hashlib':hashlib,'base64':base64,'ns':ns};exec(compile(select(input_['program'],fixture_names),'<fixed-fixture-pure-nft>','exec'),scope)
value={'uid':59999,'registryId':'00000000-0000-4000-8000-000000000001','identityId':'00000000-0000-4000-8000-000000000002'}
project={'uid':20000};store={'reserved':{'20000':{'projectId':'0123456789abcdef','identityId':'00000000-0000-4000-8000-000000000003'}}};passwd=b'root:x:0:0:root:/root:/bin/sh\n';group=b'root:x:0:\n';checks=0
def refuse(fn):
 global checks
 try:fn()
 except (AssertionError,ns['Refusal']):checks+=1;return
 raise RuntimeError('invalid fixed fixture state accepted')
unused=scope['assert_unused_fixture'];unused(store,passwd,group,[],None,value,project)
refuse(lambda:unused(store,passwd,group,[],None,value,{'uid':59999}))
refuse(lambda:unused({'reserved':{'59999':{}}},passwd,group,[],None,value,project))
refuse(lambda:unused(store,passwd+b'foreign:x:59999:9::/:/bin/sh\n',group,[],None,value,project))
refuse(lambda:unused(store,passwd,group+b'foreign:x:59999:\n',[],None,value,project))
refuse(lambda:unused(store,passwd,group,[],{'unknown':True},value,project))
refuse(lambda:unused(store,passwd,group,[{'table':{'family':'inet','name':'skp_uid_59999'}}],None,value,project))
batch=ns['egress_create_text'](value);invalid=scope['invalid_third_statement'](batch,value)
assert len(invalid.splitlines())==3 and invalid.splitlines()[:2]==batch.splitlines()[:2] and b' skp_uid_59999 sakura_fixture_absent_chain meta skuid 59999 ' in invalid.splitlines()[2]
refuse(lambda:scope['invalid_third_statement'](b'create table inet skp_uid_59999 { chain output {} }\n',value))
name,expected=ns['egress_spec'](value);objects=copy.deepcopy(expected)
for index,(entry,handle) in enumerate(zip(objects,(10,20,30))):entry[next(iter(entry))]['handle']=handle
objects[0]['table'].pop('comment');marker=expected[0]['table']['comment']
human=('table inet '+name+' { # handle 10\n\tcomment "'+marker+'"\n\tchain output { # handle 20\n\t\ttype filter hook output priority 300; policy accept;\n\t\tmeta skuid 59999 drop comment "'+marker+'" # handle 30\n\t}\n}\n').encode()
def query(role,args,data=None,output=True):return json.dumps({'nftables':[{'metainfo':{'version':'1.0.6'}}]+objects}).encode() if output else human
scope['nft']=query;before=scope['snapshot'](value,'model');assert before['handles']==[10,20,30];scope['unchanged'](before,copy.deepcopy(before))
changed=copy.deepcopy(before);changed['handles'][0]=11;refuse(lambda:scope['unchanged'](before,changed))
changed=copy.deepcopy(before);changed['objects'][0]['table']['handle']=True;refuse(lambda:scope['unchanged'](before,changed))
complete=objects;objects=objects[:1];refuse(lambda:scope['snapshot'](value,'old-table-only'))
objects=copy.deepcopy(complete);objects[2]['rule']['expr'][0]['match']['right']=20000;refuse(lambda:scope['snapshot'](value,'foreign-uid'))
objects=copy.deepcopy(complete);human=human.replace(marker.encode(),b'foreign-marker');refuse(lambda:scope['snapshot'](value,'foreign-marker'))
report={'commands':[]};scope['report']=report
def rejection(role,args,data=None,output=True):
 report['commands'].append({'returncode':1,'stdin':scope['raw'](data)});raise ns['Refusal']('EGRESS_TOOL_FAILED',{'exit':1})
scope['nft']=rejection;assert scope['rejected']('expected',batch)['refusal']['detail']['exit']==1
for bad_exit in (0,-9):
 def no_refusal(role,args,data=None,output=True):
  report['commands'].append({'returncode':bad_exit,'stdin':scope['raw'](data)});raise ns['Refusal']('EGRESS_TOOL_FAILED',{'exit':bad_exit})
 scope['nft']=no_refusal;refuse(lambda:scope['rejected']('invalid-exit',batch))
assert checks==14;print('fixed nft fixture pure refusals passed:14; no nft transaction executed')
`;
  const python = process.env.SAKURA_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  assert.equal(execFileSync(python, ['-I', '-S', '-c', model], { input: JSON.stringify({ program, controller }), encoding: 'utf8', timeout: 10000, windowsHide: true }).trim(),
    'fixed nft fixture pure refusals passed:14; no nft transaction executed');
});

test('fixed guest FD classifier distinguishes original management objects from legitimate mapped and GUI descriptors', () => {
  const source = readFileSync(new URL('../scripts/smoke-project-desktop-identity.ts', import.meta.url), 'utf8');
  const prefix = 'const singleAppFdClassifier = String.raw`', start = source.indexOf(prefix), end = source.indexOf('`;', start + prefix.length);
  assert.ok(start >= 0 && end > start);
  const classifier = source.slice(start + prefix.length, end);
  assert.ok(!classifier.includes('${'));
  const model = String.raw`
import os,re,stat
# The model uses Linux fdinfo flags; its host may be Windows.
os.O_CLOEXEC=0o2000000
def row(number=4,target='/srv/projects/owned',device='9',inode='51',mount='7',kind=stat.S_IFDIR,flags='02300000'):
 return {'number':number,'target':target,'device':device,'inode':inode,'type':kind,'flags':flags,'mountId':mount,'infoInode':inode}
def obj(role='original-source',object_kind='directory',**fields):
 return {**row(**fields),'role':role,'kind':object_kind}
def check(value,objects,role='application'):return classify_descriptor(value,objects,role)
for value in [row(target='/dev/pts/3',kind=stat.S_IFCHR),row(target='socket:[51]',kind=stat.S_IFSOCK),row(target='pipe:[51]',kind=stat.S_IFIFO)]:
 assert check(value,[obj()])['forbiddenOriginalManagementObjects']==[]
assert check(row(),[obj()])['forbiddenOriginalManagementObjects']==['original-source']
mapped=check(row(mount='19'),[obj()]);assert mapped['sameObjectTuple']==['original-source'] and mapped['sameOriginalMount']==[]
namespace=obj(role='original-view',object_kind='namespace',target='mnt:[51]',kind=stat.S_IFREG)
assert check(row(target='mnt:[51]',kind=stat.S_IFREG),[namespace])['forbiddenOriginalManagementObjects']==['original-view']
pipe=obj(role='original-supervisor-stdin',object_kind='supervisor-input',target='pipe:[51]',kind=stat.S_IFIFO)
assert check(row(number=0,target='pipe:[51]',kind=stat.S_IFIFO),[pipe],'supervisor')['forbiddenOriginalManagementObjects']==[]
for role,number in [('application',0),('wm',4),('vnc',4),('owned-descendant',4),('supervisor',4)]:
 assert check(row(number=number,target='pipe:[51]',kind=stat.S_IFIFO),[pipe],role)['forbiddenOriginalManagementObjects']==['original-supervisor-stdin']
source_file=obj(role='fixed-native-source',object_kind='file',kind=stat.S_IFREG)
assert check(row(kind=stat.S_IFREG),[source_file])['forbiddenOriginalManagementObjects']==['fixed-native-source']
assert check(row(kind=stat.S_IFREG,mount='19'),[source_file])['forbiddenOriginalManagementObjects']==[]
unknown=check(row(target='pipe:[52]',inode='52',kind=stat.S_IFIFO),[pipe]);assert unknown['unattributedPipe'] and not unknown['sameOriginalMount']
for value in [{key:value for key,value in row().items() if key!='flags'},row(flags='89'),{**row(),'infoInode':'52'},row(target='net:[51]',kind=stat.S_IFREG)]:
 try:check(value,[namespace]);raise RuntimeError('invalid descriptor was accepted')
 except (AssertionError,KeyError):pass
print('fixed FD model passed:8')
`;
  const python = process.env.SAKURA_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  assert.equal(execFileSync(python, ['-I', '-S', '-c', classifier + model], { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim(), 'fixed FD model passed:8');
});

async function ownedRfbPeer(mode: 'vnc' | 'none' | 'text', action: (url: string, errors: Error[]) => Promise<void>) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const peers = new Set<WebSocket>(), peerClosures: Promise<void>[] = [], errors: Error[] = [];
  let serverClosed = false;
  server.once('close', () => { serverClosed = true; });
  server.on('error', error => errors.push(error));
  server.on('connection', socket => {
    peers.add(socket); peerClosures.push(new Promise<void>(done => socket.once('close', () => { peers.delete(socket); done(); })));
    socket.on('error', error => errors.push(error));
    if (mode === 'text') { socket.send('RFB 003.008\n'); return; }
    let step = 0;
    const challenge = Buffer.from(Array.from({ length: 16 }, (_, index) => index));
    // Independent OpenSSL DES-EDE3 with three equal keys is DES. RFB reverses
    // the bits of each password byte before the standard DES key schedule.
    const key = Buffer.from('Own3dPwd').map(byte => {
      let reversed = 0; for (let bit = 0; bit < 8; bit++) reversed = reversed * 2 + ((byte >> bit) & 1); return reversed;
    });
    const cipher = createCipheriv('des-ede3', Buffer.concat([key, key, key]), null); cipher.setAutoPadding(false);
    const response = Buffer.concat([cipher.update(challenge), cipher.final()]);
    socket.send(Buffer.from('RFB 003.')); socket.send(Buffer.from('008\n'));
    socket.on('message', (raw, binary) => {
      try {
        assert.equal(binary, true); const value = Buffer.from(raw as Buffer);
        if (step === 0) {
          assert.equal(value.toString(), 'RFB 003.008\n'); socket.send(Buffer.from([1, mode === 'none' ? 1 : 2]));
        } else if (step === 1) {
          assert.equal(mode, 'vnc'); assert.deepEqual([...value], [2]);
          socket.send(challenge.subarray(0, 3)); socket.send(challenge.subarray(3));
        } else if (step === 2) {
          assert.equal(value.length, 16); const result = Buffer.alloc(4); result.writeUInt32BE(value.equals(response) ? 0 : 1);
          socket.send(result); if (!value.equals(response)) { step = 99; return; }
        } else if (step === 3) {
          assert.deepEqual([...value], [1]); const init = Buffer.alloc(24), name = Buffer.from('owned-protocol-unit');
          init.writeUInt16BE(1024); init.writeUInt16BE(768, 2); init[4] = 32; init[5] = 24; init[7] = 1;
          init.writeUInt32BE(name.length, 20); socket.send(init.subarray(0, 11)); socket.send(Buffer.concat([init.subarray(11), name]));
        } else if (step === 4) {
          assert.deepEqual([...value], [2, 0, 0, 1, 0, 0, 0, 0]);
        } else if (step === 5) {
          assert.deepEqual([...value], [3, 0, 0, 0, 0, 0, 0, 1, 0, 1]);
          const frame = Buffer.alloc(20); frame.writeUInt16BE(1, 2); frame.writeUInt16BE(1, 8); frame.writeUInt16BE(1, 10);
          Buffer.from([13, 77, 149, 255]).copy(frame, 16); socket.send(frame.subarray(0, 7)); socket.send(frame.subarray(7));
        } else throw new Error('Unexpected owned RFB client packet');
        step++;
      } catch (error) { errors.push(error as Error); socket.terminate(); }
    });
  });
  try {
    await new Promise<void>((done, reject) => { server.once('listening', done); server.once('error', reject); });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    await action('ws://127.0.0.1:' + address.port, errors);
  } finally {
    for (const peer of peers) peer.terminate();
    await Promise.all(peerClosures);
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    assert.equal(serverClosed, true); assert.equal(peers.size, 0);
  }
}

test('owned RFB client authenticates fragmented binary frames and physically closes success and refusal', { timeout: 15000 }, async () => {
  await ownedRfbPeer('vnc', async (url, errors) => {
    const closures: Promise<void>[] = [], states: boolean[] = [];
    const observe = (socket: WebSocket) => {
      const index = states.push(false) - 1; closures.push(new Promise<void>(done => socket.once('close', () => { states[index] = true; done(); })));
    };
    const refused = await probeOwnedDesktopRfb(url, 'WrongPwd', false, observe);
    assert.equal(refused.authenticationAccepted, false); assert.equal(refused.authenticationResult, 1); assert.equal(refused.physicallyClosed, true);
    const accepted = await probeOwnedDesktopRfb(url, 'Own3dPwd', true, observe);
    assert.equal(accepted.authenticationAccepted, true); assert.equal(accepted.framebuffer.actualPixelBytes, 4);
    assert.equal(accepted.onlyVncPasswordAuthentication, true); assert.equal(accepted.physicallyClosed, true);
    assert.ok(accepted.binaryFrames > 6 && accepted.binaryBytes > 60); await Promise.all(closures);
    assert.deepEqual(states, [true, true]); assert.deepEqual(errors, []);
  });
});

test('owned RFB client refuses unauthenticated and text transports and physically closes both', { timeout: 15000 }, async () => {
  for (const mode of ['none', 'text'] as const) await ownedRfbPeer(mode, async (url, errors) => {
    let physicallyClosed = false;
    await assert.rejects(probeOwnedDesktopRfb(url, 'Own3dPwd', true, socket => socket.once('close', () => { physicallyClosed = true; })));
    assert.equal(physicallyClosed, true); assert.deepEqual(errors, []);
  });
});

test('test-only DMI UUID preserves production argv and rejects a supplied or invalid UUID', () => {
  const original = ['-name', 'sakura-owned', '-machine', 'q35', '-accel', 'tcg,thread=single'];
  const id = '71d1b307-c853-4795-ae3b-8882b41d7f38';
  assert.deepEqual(ownedDesktopQemuArguments(original, id), [...original, '-uuid', id]);
  assert.deepEqual(original, ['-name', 'sakura-owned', '-machine', 'q35', '-accel', 'tcg,thread=single']);
  assert.throws(() => ownedDesktopQemuArguments([...original, '-uuid', id], id));
  assert.throws(() => ownedDesktopQemuArguments(original, 'other'));
});

test('real SSH2 client with no socket records non-creation without fabricating close', async () => {
  const client = new ssh2.Client(), state = { ready: false, closed: false, notCreated: false };
  client.on('close', () => { state.closed = true; });
  const result = await closeOwnedDesktopSshClient(client, state, new Promise(() => {}), 100);
  assert.equal(result, 'not-created'); assert.equal(state.notCreated, true);
  assert.equal(state.closed, false); assert.equal(Reflect.get(client, '_sock'), undefined);
});

test('real SSH2 pre-admission TCP connection waits for physical client and socket closure', { timeout: 10000 }, async () => {
  const peers = new Set<Socket>();
  let accepted!: () => void;
  const connection = new Promise<void>((done) => { accepted = done; });
  const server = createServer((socket) => {
    peers.add(socket); socket.on('error', () => {}); socket.once('close', () => peers.delete(socket));
    socket.write('SSH-2.0-owned-fixture\r\n'); accepted();
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const client = new ssh2.Client(), state = { ready: false, closed: false, notCreated: false };
  client.once('ready', () => { state.ready = true; });
  const physicalClose = new Promise<void>((done) => client.once('close', () => { state.closed = true; done(); }));
  client.on('error', () => {});
  try {
    client.connect({ host: '127.0.0.1', port: (server.address() as { port: number }).port, username: 'owned-fixture', readyTimeout: 2000 });
    assert.ok(Reflect.get(client, '_sock')); await connection;
    assert.equal(await closeOwnedDesktopSshClient(client, state, physicalClose, 2000), 'closed');
    assert.equal(state.closed, true); assert.equal(state.ready, false); assert.equal(state.notCreated, false);
    assert.equal(Reflect.get(client, '_sock').destroyed, true);
  } finally {
    client.destroy(); for (const peer of peers) peer.destroy(); await physicalClose;
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
});

test('guard process keeps stdin open until its actual admission request and physically closes', { skip: process.platform !== 'win32' }, async () => {
  const fixture = new LinuxDesktopOwnedFixture(process.cwd());
  const child = fixture.raw(process.execPath, ['-e', "process.stdin.once('data',bytes=>{process.stdout.write(bytes);process.stdin.destroy();})"], 'delayed-guard-model');
  assert.equal(child.child.stdin!.writableEnded, false);
  child.child.stdin!.end('EXACT_ADMISSION_REQUEST');
  const result = await child.done;
  assert.equal(result.stdout.toString(), 'EXACT_ADMISSION_REQUEST');
  assert.deepEqual(result.entry.exit, { code: 0, signal: null });
  assert.deepEqual(result.entry.close, result.entry.exit);
  assert.ok(result.entry.stdinClosed && result.entry.stdoutClosed && result.entry.stderrClosed);
  assert.equal(fixture.children.size, 0);
});

test('owned Linux desktop receipt uses an exact log role and rejects path escapes', () => {
  const root = 'E:\\OwnedFixture\\linux-desktop-identity-cow-aabbccdd';
  const id = '71d1b307-c853-4795-ae3b-8882b41d7f38';
  assert.equal(desktopFixtureLogPath(root, id, 'stdout'), root + '\\logs\\' + id + '.stdout.bin');
  assert.equal(desktopFixtureLogPath(root, id, 'stderr'), root + '\\logs\\' + id + '.stderr.bin');
  for (const invalid of [root + '\\..\\oldFixture', root + '\\.', 'E:relative', '\\\\host\\share', 'E:/Alias'])
    assert.throws(() => desktopFixtureLogPath(invalid, id, 'stdout'));
  for (const invalid of ['..\\oldFixture\\log', id + ':stream', id + '\\x', id.toUpperCase(), 'not-a-uuid'])
    assert.throws(() => desktopFixtureLogPath(root, invalid, 'stdout'));
  assert.throws(() => desktopFixtureLogPath(root, id, 'other' as 'stdout'));
});

test('actual PowerShell guard inventory refuses an unheld initial entry, disappearance and role change', { skip: process.platform !== 'win32' }, () => {
  const source = readFileSync(new URL('../scripts/linux-desktop-owned-fixture.ps1', import.meta.url), 'utf8');
  const start = source.indexOf("Add-Type -TypeDefinition @'"), end = source.indexOf("'@", start);
  assert.ok(start > 0 && end > start);
  // Execute the same compiled inventory membership routine. No native handles,
  // source files, fixture directories, guest or process Job are opened here.
  const model = source.slice(start, end + 2) + String.raw`
$parent='E:\OwnedModel'
$held=New-Object CowReadGuard+Held
$held.Path=$parent+'\catalog.json';$held.Directory=$false;$held.Source=$true
$stat=New-Object CowReadGuard+Info;$stat.Attributes=32;$held.Initial=$stat
[CowReadGuard]::All.Add($held.Path,$held)
[CowReadGuard]::VerifyInventory($parent,[string[]]@($held.Path),[uint32[]]@(32))
$rejected=0
foreach($case in @(
 @{paths=[string[]]@($held.Path,$parent+'\new-unlocked');attributes=[uint32[]]@(32,32)},
 @{paths=[string[]]@();attributes=[uint32[]]@()},
 @{paths=[string[]]@($held.Path);attributes=[uint32[]]@(16)},
 @{paths=[string[]]@($held.Path);attributes=[uint32[]]@(1056)},
 @{paths=[string[]]@($held.Path,$held.Path);attributes=[uint32[]]@(32,32)},
 @{paths=[string[]]@($parent+'\..\oldFixture');attributes=[uint32[]]@(32)}
)){
 try{[CowReadGuard]::VerifyInventory($parent,$case.paths,$case.attributes);throw 'MODEL_ACCEPTED_UNHELD'}
 catch{if($_.Exception.Message.Contains('MODEL_ACCEPTED_UNHELD')){throw};$rejected++}
}
if($rejected -ne 6){throw 'MODEL_REJECTION_COUNT'}
[Console]::Write('LOCKED_INVENTORY_MODEL_PASS:6')
`;
  const result = execFileSync(join(process.env.WINDIR!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; & ([ScriptBlock]::Create([Console]::In.ReadToEnd()))"],
    { input: model, windowsHide: true, timeout: 30000, encoding: 'utf8', env: { ...process.env, TEMP: existsSync(desktopFixtureParent) ? desktopFixtureParent : tmpdir(), TMP: existsSync(desktopFixtureParent) ? desktopFixtureParent : tmpdir() } });
  assert.equal(result, 'LOCKED_INVENTORY_MODEL_PASS:6');
});

test('held owned root permits product atomic replacement, while source content and root renaming remain denied', { skip: process.platform !== 'win32' }, () => {
  const source = readFileSync(new URL('../scripts/linux-desktop-owned-fixture.ps1', import.meta.url), 'utf8');
  const start = source.indexOf("Add-Type -TypeDefinition @'"), end = source.indexOf("'@", start);
  const modelParent = existsSync(desktopFixtureParent) ? desktopFixtureParent : tmpdir();
  const directory = join(modelParent, 'linux-desktop-guard-model-' + randomUUID());
  const model = source.slice(start, end + 2) + `\n$root=${JSON.stringify(directory).replace(/^"|"$/g, "'").replaceAll('\\\\', '\\')}\n` + String.raw`
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
[CowReadGuard]::NewDirectory($root,('O:'+ $sid +'G:'+ $sid +'D:P(A;OICI;FA;;;'+$sid+')(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'))
[CowReadGuard]::Open($root,$true,$false)|Out-Null
try {
 [IO.File]::WriteAllText($root+'\machines.json','original')
 [IO.File]::WriteAllText($root+'\machines.tmp','replacement')
 [IO.File]::Replace($root+'\machines.tmp',$root+'\machines.json',$root+'\machines.backup')
 if([IO.File]::ReadAllText($root+'\machines.json') -cne 'replacement'){throw 'MODEL_ATOMIC_REPLACE'}
 [CowReadGuard]::Open($root+'\machines.json',$false,$true)|Out-Null
 $writeRejected=$false
 try{[IO.File]::WriteAllText($root+'\machines.json','forbidden')}catch{$writeRejected=$true}
 if(-not $writeRejected){throw 'MODEL_SOURCE_WRITE_ACCEPTED'}
 $renameRejected=$false
 try{[IO.Directory]::Move($root,$root+'-moved')}catch{$renameRejected=$true}
 if(-not $renameRejected){throw 'MODEL_ROOT_RENAME_ACCEPTED'}
 [CowReadGuard]::Check($root)
 [Console]::Write('OWNED_CAS_SOURCE_READONLY_ROOT_PIN_PASS')
}finally{[CowReadGuard]::Close()}
`;
  const result = execFileSync(join(process.env.WINDIR!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; & ([ScriptBlock]::Create([Console]::In.ReadToEnd()))"],
    { input: model, windowsHide: true, timeout: 30000, encoding: 'utf8', env: { ...process.env, TEMP: modelParent, TMP: modelParent } });
  assert.equal(result, 'OWNED_CAS_SOURCE_READONLY_ROOT_PIN_PASS');
});
