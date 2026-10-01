import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID, sign, verify, type KeyObject } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import ssh2 from 'ssh2';
import type { AgentProtocol as AgentProtocolType, ParsedKey } from 'ssh2';
import type { ProjectIdentity, ProjectIdentityRun } from '../server/project-identity.ts';
import type { SshAgentContext, OwnedForwardAgent } from '../server/ssh-agent-scope.ts';

// ssh2 is CommonJS. A runtime named import fails under the actual Node ESM
// client even when an earlier require() model succeeds.
const { AgentProtocol, createAgent, utils } = ssh2;
const head = '9203449fef6bf2f4312d9f50a9a8f9c821e55c63';
const fixtures = {
  alpine: { name: 'sakura-guest-task-Oky2Cx', id: '45bd380f-5274-4bd8-968e-e2cb7ece4d1b',
    proof: 'build-farm-identity-evidence-27df3b09-4a47-4148-83bb-1baa85c70e9a.json',
    proofSha256: '4864b8c83d4ef8b971e3e3a5fca0e16ca8851fbf44c813dbf2a6e0b0d2716ef8',
    alpha: '110d83e57d1ff1b1', beta: 'ba739f4b664cb114' },
  debian: { name: 'sakura-guest-task-i24quD', id: '645d78d1-2848-4665-b2c1-e47903525834',
    proof: 'build-farm-identity-evidence-5b7a6c92-a125-499a-8fd5-0fb8a69fb873.json',
    proofSha256: '9f806d383f22c20d10d1219674840a359982a6acdd1b05cad3f7a00d585009e1',
    alpha: '53d89146a013a1fd', beta: '6ac8b60a75f28af8' },
  ubuntu: { name: 'sakura-guest-task-dhGwI9', id: 'f7cf98e3-e839-4eae-a55c-a214a7bdf472',
    proof: 'build-farm-identity-evidence-78f679c5-7fa9-45ce-91bf-5a76c6d9cd52.json',
    proofSha256: 'afd646a379cefd2b1b6406353910a3fe03d5e3a9c16ebc78b659b8744de21fa9',
    alpha: '83144c3a2f3ec775', beta: '8e7b77b45cf736d8' },
} as const;
const farmSummaryName = 'build-farm-identity-final-summary-7bd1d3f3-4c7f-4550-bb85-1881f82e602b.json';
const farmSummarySha256 = 'cb2ebff8b623a8a54262a6ac481bb36d8aa0d49c7b55927d0cb283562c6e133c';
const requiredSources = [
  'server/runtime-versions.ts', 'server/runtime-probe.ts', 'server/runtime-config.ts', 'server/runtime-install.ts',
  'server/workspaces.ts', 'server/guest-task.ts', 'server/project-run-scope.ts', 'server/project-identity.ts',
  'server/project-main.ts', 'server/project-services.ts', 'server/project-service-scope.ts',
  'server/project-directory-migration.ts', 'server/project-terminals.ts', 'server/jobs.ts',
  'plugins/runtimes/server.ts', 'native/project-identity/controller.py', 'native/project-identity/launcher.c',
  'native/project-identity/protocol.h', 'server/local-store.ts', 'server/build-farm.ts', 'server/project-execution.ts',
  'server/project-network-isolation.ts', 'server/secrets.ts', 'server/machines.ts', 'server/runtime.ts',
  'server/project-catalog.ts', 'server/index.ts', 'server/sdk.ts', 'server/ssh-agent-forward.ts',
  'server/ssh-agent-scope.ts', 'server/ssh-agent-broker.py', 'server/capability-actions.ts',
  'server/capability-definitions.ts', 'server/extended-features.ts', 'server/feature-suite.ts',
  'scripts/prepare-ssh-agent.mjs', 'scripts/prepare-server-assets.mjs', 'scripts/check-distribution.mjs',
  'scripts/audit-features.ts', 'scripts/package-release.mjs', 'src/feature-shared.tsx',
  'src/CapabilityActionsPanel.tsx', 'package.json',
];
const caseNames = [
  'owned-agent-real-ed25519-list-and-sign-and-original-guest-baseline',
  'exact-farm-project-pair-original-accounts-and-readonly-secret-store',
  'project-uid-staging-keeps-original-directory-and-protected-body',
  'forwarded-stock-client-lists-the-owned-key-and-signature-is-authentic',
  'same-project-two-real-slots-and-setsid-doublefork-overlap',
  'same-uid-other-cgroup-cannot-send-agent-sign-requests',
  'other-project-cannot-read-body-or-use-the-agent-endpoint',
  'cancel-first-closes-its-descendants-and-streams-and-preserves-second',
  'second-live-process-can-sign-after-first-revocation',
  'cancel-second-confirms-immutable-resource-and-account-retirement',
  'broker-ready-source-failure-releases-no-body-or-native-ticket',
  'exact-resource-cleanup-ack-loss-remains-503-and-protects-account',
  'stopped-resource-object-replacement-is-refused-without-deletion',
  'restore-exact-object-and-normal-recovery-closes-only-the-owned-run',
  'borrowed-terminal-close-cancels-only-its-own-run-and-preserves-neighbor-lease',
  'reload-reads-closed-resources-without-replay-or-install',
];
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const fixed = 'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C ';
const py = (source: string) => '/usr/bin/python3 -I -S -c ' + quote(source);
const sshString = (bytes: Buffer) => { const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length); return Buffer.concat([length, bytes]); };

function assertFarmGuestBaseline(current: any, farm: any, inspected: Record<string, ProjectIdentity>) {
  const original = farm.originalGuestBaseline, pair = farm.projectPair;
  assert.deepEqual(Object.keys(current).sort(), Object.keys(original).sort());
  assert.deepEqual(Object.keys(pair).sort(), ['alpha', 'beta', 'newAccountsClaimed', 'newMigrationsClaimed', 'reused']);
  const pairCases = farm.cases.filter((value: any) => value.name === 'exact-project-pair-and-directory-authority');
  assert.equal(pairCases.length, 1); assert.deepEqual(pairCases[0].evidence, pair);
  assert.equal(typeof pair.reused, 'boolean');
  assert.equal(pair.newAccountsClaimed, !pair.reused); assert.equal(pair.newMigrationsClaimed, !pair.reused);
  assert.equal(current.registryId, original.registryId);
  assert.deepEqual(current.readyTrees, original.readyTrees); assert.deepEqual(current.readyReceipts, original.readyReceipts);
  const identities: ProjectIdentity[] = [pair.alpha.identity, pair.beta.identity];
  assert.notEqual(pair.alpha.id, pair.beta.id); assert.notEqual(identities[0].uid, identities[1].uid);
  assert.deepEqual(Object.keys(inspected).sort(), [pair.alpha.id, pair.beta.id].sort());
  for (const [index, value] of [pair.alpha, pair.beta].entries()) {
    const identity = identities[index];
    assert.equal(identity.projectId, value.id); assert.equal(identity.registryId, original.registryId);
    assert.equal(identity.phase, 'active'); assert.equal(identity.networkIsolation, 'private');
    assert.equal(identity.account, 'skp' + identity.identityId.replaceAll('-', '').slice(0, 24));
    assert.deepEqual(inspected[value.id], identity, 'The actual root binding must equal the complete sealed Farm identity.');
  }
  if (pair.reused) {
    for (const key of ['accounts', 'bindings', 'reserved']) assert.deepEqual(current[key], original[key]);
    return { mode: 'sealed-reused-pair', originalMapsUnchanged: true, inspectedPair: identities,
      newAccountsClaimed: false, newMigrationsClaimed: false, firstObservedPairHomeFields: [] };
  }
  const addedKeys = { accounts: identities.map(value => value.account),
    bindings: identities.map(value => value.projectId + '.bin'), reserved: identities.map(value => String(value.uid)) };
  for (const key of ['accounts', 'bindings', 'reserved'] as const) {
    for (const name of addedKeys[key]) assert.equal(Object.hasOwn(original[key], name), false);
    assert.deepEqual(Object.keys(current[key]).sort(), [...Object.keys(original[key]), ...addedKeys[key]].sort());
    for (const [name, value] of Object.entries(original[key])) assert.deepEqual(current[key][name], value);
  }
  const firstObservedPairHomeFields = [];
  const firstObservedPairBindingHashes = [];
  for (const identity of identities) {
    const account = current.accounts[identity.account];
    assert.deepEqual(Object.keys(account).sort(), ['gid', 'group', 'home', 'homeMetadata', 'members', 'shell', 'uid']);
    const { homeMetadata, ...passwdGroup } = account;
    assert.deepEqual(passwdGroup, { uid: identity.uid, gid: identity.gid, home: identity.home,
      shell: '/bin/sh', group: identity.account, members: [] });
    assert.deepEqual(Object.keys(homeMetadata).sort(), ['device', 'gid', 'inode', 'links', 'mode', 'size', 'uid']);
    const { links, size, ...homeIdentity } = homeMetadata;
    assert.deepEqual(homeIdentity, { device: identity.homeDevice, inode: identity.homeInode,
      uid: identity.uid, gid: identity.gid, mode: 0o700 });
    assert.ok(Number.isSafeInteger(links) && links >= 1); assert.ok(Number.isSafeInteger(size) && size >= 0);
    assert.deepEqual(current.reserved[String(identity.uid)], { identityId: identity.identityId, projectId: identity.projectId });
    assert.match(current.bindings[identity.projectId + '.bin'], /^[a-f0-9]{64}$/);
    firstObservedPairHomeFields.push({ account: identity.account, links, size,
      provenance: 'Current first observation; links/size were not saved in the old Farm pair identity.' });
    firstObservedPairBindingHashes.push({ projectId: identity.projectId, sha256: current.bindings[identity.projectId + '.bin'],
      provenance: 'Current first observation after strict root core.inspect matched the complete sealed identity.' });
  }
  return { mode: 'sealed-pair-added-by-prior-farm', originalMapsUnchanged: true, inspectedPair: identities,
    newAccountsClaimed: false, newMigrationsClaimed: false, firstObservedPairHomeFields, firstObservedPairBindingHashes };
}

class FixtureAgent {
  readonly pipe = '\\\\.\\pipe\\sakura-owned-agent-' + randomUUID();
  readonly challengePrefix = 'sakura-agent-challenge-' + randomUUID();
  readonly publicKey: KeyObject;
  readonly blob: Buffer;
  readonly parsed: ParsedKey;
  private privateKey?: KeyObject;
  private sockets = new Map<Socket, { labels: Set<string> }>();
  private protocols = new Set<AgentProtocolType>();
  private server = createServer(socket => this.accept(socket));
  readonly audit: { sequence: number; kind: string; challenge?: string; socket: number; at: string }[] = [];
  private accepted = 0;
  constructor() {
    const key = generateKeyPairSync('ed25519'); this.privateKey = key.privateKey; this.publicKey = key.publicKey;
    const raw = key.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
    this.blob = Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(raw)]);
    const parsed = utils.parseKey('ssh-ed25519 ' + this.blob.toString('base64') + ' Sakura-owned-test');
    assert.ok(!(parsed instanceof Error)); this.parsed = parsed;
  }
  private accept(socket: Socket) {
    assert.ok(this.sockets.size < 32, 'Owned fixture agent connection budget exhausted');
    const number = ++this.accepted, value = { labels: new Set<string>() };
    this.sockets.set(socket, value); const protocol = new AgentProtocol(false); this.protocols.add(protocol);
    const audit = (kind: string, challenge?: string) => {
      assert.ok(this.audit.length < 8192); this.audit.push({ sequence: this.audit.length + 1, kind, socket: number,
        ...(challenge ? { challenge } : {}), at: new Date().toISOString() });
    };
    audit('connect'); socket.pipe(protocol).pipe(socket);
    socket.on('error', () => socket.destroy()); protocol.on('error', () => socket.destroy());
    socket.on('close', () => { this.sockets.delete(socket); this.protocols.delete(protocol); protocol.destroy(); audit('close'); });
    protocol.on('identities', request => { audit('identities'); protocol.getIdentitiesReply(request, [this.parsed]); });
    protocol.on('sign', (request, key, data) => {
      assert.equal(key.getPublicSSH().toString('base64'), this.blob.toString('base64'));
      const challenge = data.toString('utf8'); assert.ok(challenge.startsWith(this.challengePrefix + '|'));
      assert.ok(Buffer.byteLength(challenge) <= 512); assert.ok(this.privateKey);
      const label = challenge.split('|')[1]; value.labels.add(label); audit('sign', challenge);
      protocol.signReply(request, sign(null, data, this.privateKey));
    });
  }
  async start() { await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.pipe, resolve); }); }
  hasSigned(challenge: string) { return this.audit.some(value => value.kind === 'sign' && value.challenge === challenge); }
  liveFor(label: string) { return [...this.sockets.values()].filter(value => value.labels.has(label)).length; }
  challenge(label: string, suffix = 'leader', phase = 'initial') { return [this.challengePrefix, label, suffix, phase].join('|'); }
  async baseline() {
    const agent = createAgent(this.pipe);
    const keys = await new Promise<ParsedKey[]>((resolve, reject) => agent.getIdentities((error, keys) => {
      if (error) reject(error); else resolve(keys as ParsedKey[]);
    }));
    assert.equal(keys.length, 1); assert.ok(keys[0].getPublicSSH().equals(this.blob));
    const challenge = this.challenge('host-model');
    const signature = await new Promise<Buffer>((resolve, reject) => agent.sign(keys[0], Buffer.from(challenge), (error, signature) => {
      if (error) reject(error); else { assert.ok(signature); resolve(signature); }
    }));
    assert.equal(signature.length, 64); assert.equal(verify(null, Buffer.from(challenge), this.publicKey, signature), true);
    assert.equal(verify(null, Buffer.from(challenge + 'changed'), this.publicKey, signature), false);
    return { publicKeySha256: hash(this.blob), algorithm: 'ssh-ed25519', signatureVerified: true,
      changedChallengeRejected: true, identities: keys.length, signRequests: this.audit.filter(value => value.kind === 'sign').length,
      defaultEsmImport: true };
  }
  async close() {
    await Promise.all([...this.sockets.keys()].map(socket => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Own fixture Agent socket close not observed')), 5000);
      socket.once('close', () => { clearTimeout(timer); resolve(); }); socket.destroy();
    })));
    for (const protocol of this.protocols) protocol.destroy();
    if (this.server.listening) await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
    assert.equal(this.sockets.size, 0); assert.equal(this.protocols.size, 0); this.privateKey = undefined;
  }
}

// This application is written by the actual project UID to a new child of its
// unchanged Farm directory. Four client processes independently connect and
// sign; none shares the leader's connected FD across fork.
const applicationPython = String.raw`import base64,hashlib,json,os,re,signal,socket,stat,struct,subprocess,sys,time
mode,label,body_hash,root_only,key_b64,challenge_prefix=sys.argv[1:7]
assert re.fullmatch(r'[a-z][a-z0-9-]{0,40}',label)
base=os.path.dirname(os.path.abspath(__file__));body=os.environ.get('AGENT_BODY','')
# Independent first-body witness: readiness failure must not reach this write,
# even if a premature application later fails to connect or sign.
entry=os.open(base+'/'+label+'-entered.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
try:
 data=json.dumps({'uid':os.getuid(),'pid':os.getpid(),'entered':True}).encode()
 assert os.write(entry,data)==len(data);os.fsync(entry)
finally:os.close(entry)
assert hashlib.sha256(body.encode()).hexdigest()==body_hash
blob=base64.b64decode(key_b64,validate=True)
def string(value):return struct.pack('>I',len(value))+value
def receive(stream,size):
 data=b''
 while len(data)<size:
  piece=stream.recv(size-len(data))
  if not piece:raise EOFError('agent response EOF')
  data+=piece
 return data
def packet(stream,data):
 assert len(data)<=262144;stream.sendall(struct.pack('>I',len(data))+data)
 length=struct.unpack('>I',receive(stream,4))[0];assert 0<length<=262144
 return receive(stream,length)
def unpack(value,offset):
 assert len(value)>=offset+4
 size=struct.unpack('>I',value[offset:offset+4])[0];assert size<=len(value)-offset-4
 return value[offset+4:offset+4+size],offset+4+size
def identities(stream):
 value=packet(stream,bytes([11]));assert value[0]==12 and struct.unpack('>I',value[1:5])[0]==1
 key,end=unpack(value,5);comment,end=unpack(value,end);assert end==len(value) and key==blob
 return hashlib.sha256(key).hexdigest()
def signature(stream,suffix,phase='initial'):
 challenge='|'.join([challenge_prefix,label,suffix,phase])
 value=packet(stream,bytes([13])+string(blob)+string(challenge.encode())+struct.pack('>I',0))
 assert value[0]==14
 packed,end=unpack(value,1);assert end==len(value)
 algorithm,offset=unpack(packed,0);signed,offset=unpack(packed,offset)
 assert offset==len(packed) and algorithm==b'ssh-ed25519' and len(signed)==64
 return {'challenge':challenge,'signature':base64.b64encode(signed).decode()}
def connection(path=None):
 stream=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);stream.settimeout(4)
 stream.connect(path or os.environ['SSH_AUTH_SOCK']);return stream
def save(name,value):
 path=base+'/'+label+'-'+name+'.json';temporary=path+'.new'
 fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  data=json.dumps(value).encode();assert len(data)<16384
  assert os.write(fd,data)==len(data);os.fsync(fd)
 finally:os.close(fd)
 assert not os.path.lexists(path);os.rename(temporary,path)
def publish(suffix,extra):
 status=dict(line.split(':',1) for line in open('/proc/self/status') if ':' in line)
 fields=open('/proc/self/stat').read().rsplit(') ',1)[1].split()
 denied=False
 try:fd=os.open(root_only+'/forbidden',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.close(fd)
 except PermissionError:denied=True
 ns=os.stat('/proc/self/ns/net');descriptors=[]
 for name in os.listdir('/proc/self/fd'):
  try:descriptors.append({'fd':int(name),'target':os.readlink('/proc/self/fd/'+name)})
  except FileNotFoundError:pass
 value={'version':1,'label':label,'suffix':suffix,'uid':os.getuid(),'euid':os.geteuid(),'gid':os.getgid(),
  'groups':os.getgroups(),'pid':os.getpid(),'pgid':os.getpgrp(),'sid':os.getsid(0),'ticks':fields[19],
  'home':os.environ.get('HOME'),'cwd':os.getcwd(),'bootId':open('/proc/sys/kernel/random/boot_id').read().strip(),
  'networkDevice':str(ns.st_dev),'networkInode':str(ns.st_ino),'cgroup':open('/proc/self/cgroup').read().strip(),
  'noNewPrivs':status['NoNewPrivs'].strip(),'caps':{key:status[key].strip() for key in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb')},
  'rootWriteDenied':denied,'bodyPresent':True,'descriptors':descriptors,'agentSocket':os.environ.get('SSH_AUTH_SOCK'),**extra}
 save(suffix,value);return value
def client(suffix,hang):
 with connection() as stream:
  key_sha=identities(stream);signed=signature(stream,suffix)
  result=publish(suffix,{'keySha256':key_sha,**signed})
  if not hang:print(json.dumps(result));return
  last=0;resigned=False
  while True:
   if time.monotonic()-last>1.5:identities(stream);last=time.monotonic()
   trigger=base+'/'+label+'-resign.request'
   if suffix=='leader' and not resigned and os.path.lexists(trigger):
    fd=os.open(trigger,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:info=os.fstat(fd);assert stat.S_ISREG(info.st_mode) and info.st_uid==os.getuid() and info.st_nlink==1 and info.st_size==0
    finally:os.close(fd)
    save('resigned',{'uid':os.getuid(),'bootId':result['bootId'],'pid':result['pid'],'ticks':result['ticks'],
     **signature(stream,suffix,'after-revocation')});resigned=True
   time.sleep(0.2)
if mode=='hang':
 for kind in (signal.SIGTERM,signal.SIGHUP):signal.signal(kind,signal.SIG_IGN)
 for suffix in ('newgroup','setsid','doublefork'):
  child=os.fork()
  if child==0:
   if suffix=='newgroup':os.setpgid(0,0)
   else:os.setsid()
   if suffix=='doublefork' and os.fork()!=0:os._exit(0)
   client(suffix,True);os._exit(0)
  if suffix=='doublefork':os.waitpid(child,0)
 client('leader',True)
elif mode=='once':
 stock=subprocess.run(['/usr/bin/ssh-add','-L'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=8)
 assert stock.returncode==0 and not stock.stderr and len(stock.stdout)<4096
 fields=stock.stdout.decode().strip().split();assert fields[0]=='ssh-ed25519' and fields[1]==key_b64
 client('leader',False)
elif mode=='attack':
 foreign_socket,foreign_pid,foreign_ticks,foreign_script=sys.argv[7:11]
 fields=open('/proc/'+foreign_pid+'/stat').read().rsplit(') ',1)[1].split()
 assert fields[19]==foreign_ticks and fields[0] not in ('X','Z')
 result=publish('leader',{})
 for name,path in (('environment','/proc/'+foreign_pid+'/environ'),('descriptors','/proc/'+foreign_pid+'/fd'),('script',foreign_script)):
  try:
   if name=='descriptors':os.listdir(path)
   else:
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:os.read(fd,131073)
    finally:os.close(fd)
   result[name+'Denied']=False
  except PermissionError:result[name+'Denied']=True
 try:result['foreignArgvContainsBody']=body.encode() in open('/proc/'+foreign_pid+'/cmdline','rb').read(65537)
 except PermissionError:result['foreignArgvContainsBody']=False;result['foreignArgvDenied']=True
 challenge='|'.join([challenge_prefix,label,'leader','forbidden'])
 accepted=False;failure=''
 try:
  with connection(foreign_socket) as stream:
   reply=packet(stream,bytes([13])+string(blob)+string(challenge.encode())+struct.pack('>I',0))
   accepted=reply[0]==14
 except (PermissionError,ConnectionResetError,BrokenPipeError,EOFError,FileNotFoundError,OSError) as error:failure=type(error).__name__
 result.update(agentAccepted=accepted,failure=failure,challenge=challenge)
 print(json.dumps(result))
else:raise RuntimeError('fixture mode')
`;

const observerPython = String.raw`import base64,grp,hashlib,json,os,pwd,re,stat,sys
request=json.load(sys.stdin);operation=request['operation']
boot=open('/proc/sys/kernel/random/boot_id').read().strip()
assert request.get('bootId',boot)==boot
def metadata(info):
 return {'device':str(info.st_dev),'inode':str(info.st_ino),'uid':info.st_uid,'gid':info.st_gid,
  'mode':stat.S_IMODE(info.st_mode),'links':info.st_nlink,'size':info.st_size}
def bounded(path,uid=None,limit=16384,mode=None):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
 try:
  info=os.fstat(fd)
  assert stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_size<=limit
  assert uid is None or info.st_uid==uid
  assert mode is None or stat.S_IMODE(info.st_mode)==mode
  data=os.read(fd,limit+1);assert len(data)<=limit
  assert metadata(info)==metadata(os.fstat(fd))
  return data,metadata(info)
 finally:os.close(fd)
def directory(path,uid=None,mode=None):
 info=os.lstat(path);assert stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode)
 assert uid is None or info.st_uid==uid
 assert mode is None or stat.S_IMODE(info.st_mode)==mode
 return metadata(info)
def process(value):
 try:
  fields=open('/proc/'+str(value['pid'])+'/stat').read().rsplit(') ',1)[1].split()
  alive=fields[19]==value['ticks'] and fields[0] not in ('Z','X')
  result={'pid':value['pid'],'ticks':value['ticks'],'alive':alive,'state':fields[0]}
  if alive:
   result['uid']=os.stat('/proc/'+str(value['pid'])).st_uid
   result['cgroup']=open('/proc/'+str(value['pid'])+'/cgroup').read().strip()
   ns=os.stat('/proc/'+str(value['pid'])+'/ns/net')
   result.update(networkDevice=str(ns.st_dev),networkInode=str(ns.st_ino))
  return result
 except FileNotFoundError:return {'pid':value['pid'],'ticks':value['ticks'],'alive':False,'state':'absent'}
def control(run_id):
 assert re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',run_id)
 path='/run/sakura-guest-tasks/'+run_id
 if not os.path.lexists(path):return {'exists':False,'directory':path}
 result={'exists':True,'directory':path,'metadata':directory(path,0,0o700),'files':{}}
 for name in sorted(os.listdir(path)):
  assert name=='owner' or name.startswith('.sakura-job-'+run_id+'.')
  data,info=bounded(path+'/'+name,0,16384,0o600)
  result['files'][name]={'metadata':info,'sha256':hashlib.sha256(data).hexdigest()}
  if name=='owner':
   fields=data.decode('ascii').split();assert len(fields)==3 and fields[0]=='1' and fields[2]==boot
   assert re.fullmatch(r'[a-f0-9-]{36}',fields[1]);result['owner']={'version':1,'nonce':fields[1],'bootId':fields[2]}
 return result
def tree(path):
 info=os.lstat(path);assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
 items={};count=0;total=0
 for current,dirs,files in os.walk(path,followlinks=False):
  for name in ['.']+sorted(dirs+files):
   item=current if name=='.' else current+'/'+name;value=os.lstat(item);relative=os.path.relpath(item,path)
   count+=1;assert count<=30000
   result=metadata(value)
   if stat.S_ISLNK(value.st_mode):result['target']=os.readlink(item)
   elif stat.S_ISDIR(value.st_mode):result['type']='directory'
   else:
    assert stat.S_ISREG(value.st_mode) and value.st_uid==0 and not value.st_mode&0o022
    assert value.st_size<=134217728
    fd=os.open(item,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
    try:
     assert (value.st_dev,value.st_ino)==(os.fstat(fd).st_dev,os.fstat(fd).st_ino)
     digest=hashlib.sha256();read=0
     while True:
      data=os.read(fd,262144)
      if not data:break
      read+=len(data);total+=len(data);assert read<=value.st_size and total<=268435456
      digest.update(data)
     assert read==value.st_size;result['sha256']=digest.hexdigest()
    finally:os.close(fd)
   items[relative]=result
 return {'path':path,'count':count,'bytes':total,'sha256':hashlib.sha256(json.dumps(items,sort_keys=True).encode()).hexdigest(),'root':metadata(info)}
if operation=='baseline':
 data,info=bounded('/var/lib/sakura/project-identities/registry.json',0,1048576,0o600)
 registry=json.loads(data);accounts={};bindings={};identity_files={}
 for uid,value in registry['reserved'].items():
  name='skp'+value['identityId'].replace('-','')[:24]
  try:entry=pwd.getpwnam(name)
  except KeyError:accounts[name]=None;continue
  assert entry.pw_uid==int(uid) and entry.pw_gid==int(uid)
  group=grp.getgrgid(entry.pw_gid)
  home=directory(entry.pw_dir) if os.path.lexists(entry.pw_dir) else None
  accounts[name]={'uid':entry.pw_uid,'gid':entry.pw_gid,'home':entry.pw_dir,'shell':entry.pw_shell,
   'group':group.gr_name,'members':group.gr_mem,'homeMetadata':home}
 for name in sorted(os.listdir('/var/lib/sakura/project-identities/projects')):
  value,details=bounded('/var/lib/sakura/project-identities/projects/'+name,0,16384,0o600)
  bindings[name]=hashlib.sha256(value).hexdigest()
 for path in request.get('readyPaths',[]):
  assert re.fullmatch(r'/opt/sakura-runtimes/(?:node-22[.]12[.]0|python-3[.]12[.]12|python-managed-[a-f0-9-]{36})',path)
  identity_files[path]=tree(path)
 receipts={}
 for name in ('node-22.12.0','python-3.12.12'):
  path='/var/lib/sakura/runtime-versions/'+name+'.json'
  try:
   value,details=bounded(path,0,1048576,0o600);receipts[path]={'metadata':details,'sha256':hashlib.sha256(value).hexdigest()}
  except FileNotFoundError:receipts[path]=None
 result={'bootId':boot,'reserved':registry['reserved'],'registryId':registry['registryId'],
  'accounts':accounts,'bindings':bindings,'readyTrees':identity_files,'readyReceipts':receipts}
elif operation=='markers':
 result={'bootId':boot,'reports':[],'complete':True}
 for path in request['paths']:
  try:data,info=bounded(path,request['uid'],16384,0o600)
  except FileNotFoundError:result['complete']=False;break
  value=json.loads(data);assert value['uid']==request['uid'] and value['bootId']==boot
  value['observed']=process(value);value['markerMetadata']=info;result['reports'].append(value)
elif operation=='scope':
 run=request['run'];assert run['bootId']==boot
 path='/sys/fs/cgroup/'+run['cgroupName'];assert run['cgroupName']=='sakura-task-'+run['runId']
 if os.path.lexists(path):
  info=directory(path);assert info['device']==run['cgroupDevice'] and info['inode']==run['cgroupInode']
  result={'bootId':boot,'cgroupExists':True,'metadata':info,'events':open(path+'/cgroup.events').read().strip()}
 else:result={'bootId':boot,'cgroupExists':False}
 result['processes']=[process(value) for value in request.get('reports',[])]
 result['control']=control(run['runId'])
elif operation=='root-argv':
 needles=[value.encode() for value in request['needles']];matches=[]
 for name in os.listdir('/proc'):
  if not name.isdigit():continue
  try:
   if os.stat('/proc/'+name).st_uid!=0:continue
   data=open('/proc/'+name+'/cmdline','rb').read(131073)
   if any(needle in data for needle in needles):matches.append(int(name))
  except OSError:pass
 result={'bootId':boot,'matchingRootPids':matches}
elif operation=='paths':
 result={'bootId':boot,'paths':{}}
 for path in request['paths']:
  if not os.path.lexists(path):result['paths'][path]=None;continue
  data,info=bounded(path,request.get('uid'),1048576)
  result['paths'][path]={'metadata':info,'sha256':hashlib.sha256(data).hexdigest()}
elif operation=='namespace':
 result={'bootId':boot,'host':metadata(os.stat('/proc/self/ns/net')),
  'private':metadata(os.stat('/run/netns/sk-'+request['projectId']))}
elif operation=='resource':
 context=request['context'];lease=context['resource']['leaseId']
 assert re.fullmatch(r'[a-f0-9-]{36}',lease) and context['owner']['bootId']==boot
 filename='/run/sakura-agent-forwards/records/'+lease+'.json'
 value,details=bounded(filename,0,65536,0o600);record=json.loads(value)
 assert record['context']==context
 def unix(path):
  value=os.lstat(path)
  return {'device':str(value.st_dev),'inode':str(value.st_ino),'uid':value.st_uid,'gid':value.st_gid,
   'mode':stat.S_IMODE(value.st_mode),'type':stat.S_IFMT(value.st_mode)}
 endpoint='/run/sakura-agent-sockets/'+lease
 result={'bootId':boot,'record':record,'recordSha256':hashlib.sha256(value).hexdigest(),
  'recordMetadata':details,'endpointDirectory':unix(endpoint) if os.path.lexists(endpoint) else None,
  'endpoint':unix(endpoint+'/agent') if os.path.lexists(endpoint+'/agent') else None}
 for key in ('broker','source'):
  identity=record[key] if key=='broker' else (record[key]['peer'] if record[key] else None)
  if identity:result[key+'Process']=process({'pid':identity['pid'],'ticks':identity['startTicks']})
 if record['source']:
  result['sourceSocketPresent']=os.path.lexists(record['source']['path'])
  if result['sourceSocketPresent']:
   result['sourceSocket']=unix(record['source']['path']);result['sourceParent']=unix(os.path.dirname(record['source']['path']))
 if request.get('rootOnly'):result['rootInfo']=unix(request['rootOnly'])
else:raise RuntimeError('observer operation')
print(json.dumps(result))
`;

const rootInitializePython = String.raw`import json,os,re,stat,sys
value=json.load(sys.stdin);path=value['rootOnly']
assert re.fullmatch(r'/run/sakura-owned-agent-[a-f0-9-]{36}',path)
info=os.lstat('/run');assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
assert not os.path.lexists(path);os.mkdir(path,0o700)
info=os.lstat(path);assert info.st_uid==0 and info.st_gid==0 and stat.S_IMODE(info.st_mode)==0o700
print(json.dumps({'path':path,'device':str(info.st_dev),'inode':str(info.st_ino)}))
`;
const stagePython = (child: string) => `import base64,hashlib,json,os,stat\np=${JSON.stringify(child)}\n` +
  `assert not os.path.lexists(p)\nos.mkdir(p,0o700)\nfd=os.open(p+'/fixture.py',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)\n` +
  `try:\n data=base64.b64decode(${JSON.stringify(Buffer.from(applicationPython).toString('base64'))},validate=True)\n` +
  ` assert os.write(fd,data)==len(data);os.fsync(fd)\nfinally:os.close(fd)\n` +
  `print(json.dumps({'uid':os.getuid(),'programSha256':hashlib.sha256(data).hexdigest()}))`;

// Mutation is limited to one new already-stopped lease. The original socket is
// preserved by rename and restored by exact inode, never substituted as a new
// authority. Unknown objects remain untouched on any guard failure.
const replaceEndpointPython = String.raw`import hashlib,json,os,re,stat,sys
def checked_stopped_record(active,current):
 assert set(active)==set(current)=={'version','context','phase','scope','source','endpointDirectory','endpoint','broker','failure'}
 assert active['phase']=='ready' and active['failure'] is None
 assert {key:value for key,value in current.items() if key not in ('phase','failure')}=={key:value for key,value in active.items() if key not in ('phase','failure')}
 assert (current['phase']=='ready' and current['failure'] is None) or (current['phase']=='failed' and isinstance(current['failure'],str) and re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}',current['failure']))
 return current
request=json.load(sys.stdin);context=request['context'];run=request['run'];record=request['record']
checked_stopped_record(request['activeRecord'],record)
boot=open('/proc/sys/kernel/random/boot_id').read().strip();assert boot==context['owner']['bootId']==run['bootId']
assert run['runId']==context['owner']['runId'] and run['cgroupName']=='sakura-task-'+run['runId']
assert not os.path.lexists('/sys/fs/cgroup/'+run['cgroupName'])
for value in request['reports']:
 try:fields=open('/proc/'+str(value['pid'])+'/stat').read().rsplit(') ',1)[1].split()
 except FileNotFoundError:continue
 assert fields[19]!=value['ticks'] or fields[0] in ('Z','X')
lease=context['resource']['leaseId'];assert re.fullmatch(r'[a-f0-9-]{36}',lease)
root=request['rootOnly'];assert re.fullmatch(r'/run/sakura-owned-agent-[a-f0-9-]{36}',root)
def info(path):
 value=os.lstat(path)
 return {'device':str(value.st_dev),'inode':str(value.st_ino),'uid':value.st_uid,'gid':value.st_gid,
  'mode':stat.S_IMODE(value.st_mode),'type':stat.S_IFMT(value.st_mode)}
assert info(root)==request['rootInfo']
name='/run/sakura-agent-forwards/records/'+lease+'.json'
fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
try:
 value=os.fstat(fd);assert stat.S_ISREG(value.st_mode) and value.st_uid==0 and value.st_nlink==1 and stat.S_IMODE(value.st_mode)==0o600
 data=os.read(fd,65537);assert len(data)<=65536
 current=json.loads(data);assert current['context']==context and current==record
finally:os.close(fd)
directory='/run/sakura-agent-sockets/'+lease;endpoint=directory+'/agent';backup=root+'/'+lease+'.original-socket'
assert info(directory)==record['endpointDirectory']
if request['action']=='replace':
 assert info(endpoint)==record['endpoint'] and not os.path.lexists(backup) and sorted(os.listdir(directory))==['agent']
 os.rename(endpoint,backup)
 fd=os.open(endpoint,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:assert os.write(fd,b'sakura-owned-inert-replacement')==30;os.fsync(fd)
 finally:os.close(fd)
 assert info(backup)==record['endpoint'];result={'backup':backup,'original':info(backup),'replacement':info(endpoint)}
elif request['action']=='restore':
 assert info(backup)==record['endpoint'] and info(endpoint)==request['replacement'] and sorted(os.listdir(directory))==['agent']
 fd=os.open(endpoint,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:assert os.read(fd,31)==b'sakura-owned-inert-replacement' and not os.read(fd,1)
 finally:os.close(fd)
 os.unlink(endpoint);os.rename(backup,endpoint)
 assert info(endpoint)==record['endpoint'] and not os.path.lexists(backup);result={'restored':info(endpoint),'backupAbsent':True}
else:raise RuntimeError('owned endpoint operation')
for path in [directory,root]:
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
print(json.dumps(result))
`;

type Setup = { workspace: string; parent: string; root: string; machineDirectory: string; vmId: string;
  distro: keyof typeof fixtures; record: any; freezeFile: string; freezeBytes: Buffer; freeze: any;
  farm: any; historicalFiles: { file: string; sha256: string }[]; secretDirectory: string;
  hostFiles: { file: string; sha256: string }[]; oldJournals: Map<string, any>; oldArchiveFiles: { file: string; sha256: string }[];
  exactQemu: () => number; brokerManifest: any; originalSelection: any };

async function validate(args: string[]): Promise<Setup> {
  assert.equal(args.length, 4);
  const [distroInput, fixtureInput, stampInput, mode] = args;
  assert.ok(Object.hasOwn(fixtures, distroInput)); assert.ok(['--validate-only', '--reuse-existing'].includes(mode));
  const distro = distroInput as keyof typeof fixtures, selected = fixtures[distro];
  assert.equal(process.platform, 'win32'); assert.deepEqual(process.execArgv, ['--import', 'tsx']);
  assert.equal(process.env.NODE_OPTIONS || '', '');
  const workspace = await realpath(resolve('.')); assert.match(workspace, /^[dD]:\\/);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(), head);
  const parent = await realpath(join(workspace, '.data', 'network-remaining-test-temp'));
  const root = await realpath(resolve(fixtureInput)); assert.equal(dirname(root), parent); assert.equal(basename(root), selected.name);
  const freezeFile = await realpath(resolve(stampInput)); assert.equal(dirname(freezeFile), parent);
  assert.match(basename(freezeFile), /^ssh-agent-project-identity-freeze-[a-f0-9-]{36}\.json$/);
  const freezeBytes = await readFile(freezeFile), freeze = JSON.parse(freezeBytes.toString('utf8'));
  assert.equal(freeze.version, 1); assert.equal(freeze.frozen, true); assert.equal(freeze.head, head);
  assert.equal(hash(await readFile(join(workspace, 'scripts/smoke-ssh-agent-project-identity.ts'))), freeze.scriptSha256);
  assert.equal(typeof freeze.sourceSha256, 'object');
  for (const file of requiredSources) assert.match(freeze.sourceSha256[file] || '', /^[a-f0-9]{64}$/);
  for (const [file, expected] of Object.entries(freeze.sourceSha256) as [string, string][]) {
    assert.ok(file === 'package.json' || /^(server|plugins|native|shared|src|scripts)\/[A-Za-z0-9/_.-]+$/.test(file));
    assert.ok(file.split('/').every(part => part && !['.', '..'].includes(part))); assert.match(expected, /^[a-f0-9]{64}$/);
    assert.equal(hash(await readFile(join(workspace, file))), expected, 'Source changed: ' + file);
  }
  assert.equal(freeze.asset?.directory, '.sakura-server/assets/ssh-agent');
  const asset = join(workspace, freeze.asset.directory), manifestBytes = await readFile(join(asset, 'manifest.json'));
  for (const path of [asset, join(asset, 'manifest.json'), join(asset, 'broker.py')]) {
    assert.equal(await realpath(path), path); assert.equal((await lstat(path)).isSymbolicLink(), false);
  }
  assert.equal(hash(manifestBytes), freeze.asset.manifestSha256);
  const brokerManifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.deepEqual(Object.keys(brokerManifest).sort(), ['file', 'sha256', 'size', 'version']);
  assert.equal(brokerManifest.version, 1); assert.equal(brokerManifest.file, 'broker.py');
  assert.ok(Number.isInteger(brokerManifest.size) && brokerManifest.size > 0 && brokerManifest.size <= 262144);
  const brokerBytes = await readFile(join(asset, 'broker.py'));
  assert.equal(brokerBytes.length, brokerManifest.size); assert.equal(hash(brokerBytes), brokerManifest.sha256);
  assert.equal(brokerManifest.sha256, freeze.asset.brokerSha256);
  assert.equal(brokerManifest.sha256, freeze.sourceSha256['server/ssh-agent-broker.py']);
  const identityAsset = join(workspace, '.sakura-server', 'assets', 'project-identity');
  const manifest = JSON.parse(await readFile(join(identityAsset, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, 1); assert.deepEqual(manifest.files.map((value: any) => value.name), ['protocol.h', 'launcher.c', 'controller.py']);
  const aggregate = createHash('sha256');
  for (const entry of manifest.files) {
    const bytes = await readFile(join(identityAsset, entry.name)); assert.equal(bytes.length, entry.size);
    assert.equal(hash(bytes), entry.sha256); assert.equal(entry.sha256, freeze.sourceSha256['native/project-identity/' + entry.name]);
    aggregate.update(entry.name); aggregate.update(bytes);
  }
  assert.equal(aggregate.digest('hex'), manifest.build); assert.equal(manifest.build, '94bc2a7fb050ac8a72cce5fcf56997c6c44ba4a8473cd543cff6d36ff407b905');
  const records = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8')); assert.equal(records.length, 1);
  const record = records[0]; assert.equal(record.id, selected.id); assert.equal(record.distro, distro);
  assert.equal(record.name, 'guest-task-cgroup-smoke'); assert.equal(record.bootstrapped, true);
  assert.ok(!record.template || record.template === 'none');
  assert.deepEqual(record.forwards || [], []); assert.deepEqual(record.snapshots || [], []);
  for (const key of ['sandbox', 'storagePoolId', 'haPromotion', 'haRetirement', 'lastError', 'rescueOf']) assert.equal(record[key], undefined);
  const vmId = selected.id, machineDirectory = await realpath(join(root, 'machines', vmId));
  assert.equal(dirname(machineDirectory), await realpath(join(root, 'machines')));
  for (const path of [parent, root, machineDirectory, join(machineDirectory, 'disk.qcow2')]) {
    assert.equal(await realpath(path), path); assert.equal((await lstat(path)).isSymbolicLink(), false);
  }
  assert.ok((await lstat(join(machineDirectory, 'disk.qcow2'))).isFile());
  const exactQemu = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$ownedRoot='" + root.replaceAll("'", "''") + "';$ownedVm='" + vmId + "';@(" +
    "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'sakura-qemu.exe' -or $_.Name -like 'qemu-system-*.exe') -and " +
    "$_.CommandLine -and $_.CommandLine.Contains($ownedRoot) -and $_.CommandLine.Contains($ownedVm) }).Count"],
  { encoding: 'utf8', windowsHide: true }).trim());
  assert.equal(exactQemu(), 0, 'This exact owned fixture is already running.');
  const historicalFiles: Setup['historicalFiles'] = [], hostFiles: Setup['hostFiles'] = [];
  const remember = async (file: string, expected?: string, target = historicalFiles) => {
    assert.equal(await realpath(file), file); const info = await lstat(file);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 16 * 1024 * 1024);
    const bytes = await readFile(file); if (expected) assert.equal(hash(bytes), expected);
    if (!target.some(value => value.file === file)) target.push({ file, sha256: hash(bytes) });
    return JSON.parse(bytes.toString('utf8'));
  };
  const summary = await remember(join(parent, farmSummaryName), farmSummarySha256);
  assert.equal(summary.status, 'passed'); assert.equal(summary.passed, true); assert.equal(summary.casesTotal, 41);
  assert.equal(summary.proofs.length, 3); let farm: any;
  for (const [key, fixture] of Object.entries(fixtures)) {
    const entry = summary.proofs.find((value: any) => value.distro === key); assert.ok(entry);
    const owned = join(parent, fixture.name), file = join(owned, fixture.proof);
    assert.equal(entry.file, file); assert.equal(entry.fileSha256, fixture.proofSha256);
    const proof = await remember(file, fixture.proofSha256);
    assert.equal(proof.fixture, owned); assert.equal(dirname(await realpath(file)), owned);
    assert.equal(proof.vmId, fixture.id); assert.equal(proof.distro, key);
    assert.equal(proof.passed, true); assert.equal(proof.phase, 'finished'); assert.deepEqual(proof.cleanupErrors, []);
    assert.equal(proof.vmStopped, true); assert.equal(proof.liveEntries, 0); assert.equal(proof.exactQemuMatches, 0);
    assert.equal(proof.ownedQemuSettled, true); assert.equal(proof.cases.length, key === 'alpine' ? 13 : 14);
    assert.equal(new Set(proof.cases.map((value: any) => value.name)).size, proof.cases.length);
    for (const field of ['error', 'failedCase', 'activeCase']) assert.equal(Object.hasOwn(proof, field), false);
    assert.equal(entry.vmId, fixture.id); assert.equal(entry.fixture, owned); assert.equal(entry.actualExitCode, 0);
    assert.equal(entry.exactQemuMatches, 0); assert.equal(proof.projectPair.alpha.id, fixture.alpha);
    assert.equal(proof.projectPair.beta.id, fixture.beta);
    for (const [file, expected] of [[entry.logFile, entry.logSha256], [entry.exitFile, entry.exitSha256]] as [string, string][]) {
      assert.equal(dirname(await realpath(file)), parent); assert.match(expected, /^[a-f0-9]{64}$/);
      const bytes = await readFile(file); assert.equal(hash(bytes), expected); assert.ok(bytes.length <= 16 * 1024 * 1024);
      historicalFiles.push({ file, sha256: expected });
    }
    const exit = JSON.parse(await readFile(entry.exitFile, 'utf8')); assert.equal(exit.actualExitCode, 0);
    assert.equal(exit.proofFile, file); assert.equal(exit.logFile, entry.logFile); assert.deepEqual(exit.client.execArgv, ['--import', 'tsx']);
    for (const pair of [proof.projectPair.alpha, proof.projectPair.beta]) {
      assert.equal(pair.identity.projectId, pair.id); assert.equal(pair.identity.phase, 'active');
      assert.equal(pair.identity.networkIsolation, 'private'); assert.match(pair.configVersion, /^[a-f0-9]{64}$/);
    }
    if (key === distro) farm = proof;
  }
  assert.ok(farm);
  for (const value of farm.previousEvidence.files) {
    assert.ok(value.file.startsWith(parent + '\\')); assert.match(value.sha256, /^[a-f0-9]{64}$/);
    await remember(value.file, value.sha256);
  }
  for (const name of await readdir(root)) if (name.endsWith('.json') && name !== 'machines.json') await remember(join(root, name));
  const farmScope = await realpath(farm.hostScope);
  assert.equal(dirname(farmScope), root); assert.equal(basename(farmScope), 'build-farm-owned-' + farm.invocation);
  const secretDirectory = join(farmScope, 'secrets'), secretFile = join(secretDirectory, vmId + '.json');
  if (distro !== 'alpine') {
    assert.equal(await realpath(secretDirectory), secretDirectory); assert.equal((await lstat(secretDirectory)).isSymbolicLink(), false);
    await remember(secretFile, undefined, hostFiles);
  } else {
    try { await lstat(secretFile); throw new Error('Alpine unexpectedly has old Farm secret references'); }
    catch (error) { assert.equal((error as NodeJS.ErrnoException).code, 'ENOENT'); }
  }
  const catalogFile = join(machineDirectory, 'projects.json');
  const catalog = await remember(catalogFile, undefined, hostFiles);
  assert.ok(catalog.projects.length <= 20); const originalSelection = structuredClone(catalog);
  for (const item of catalog.projects) {
    assert.match(item.id, /^(default|[a-f0-9]{16})$/); assert.equal(typeof item.name, 'string');
    const file = join(machineDirectory, item.id === 'default' ? 'project.json' : 'project-' + item.id + '.json');
    try { await remember(file, undefined, hostFiles); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  for (const [kind, id] of [['alpha', selected.alpha], ['beta', selected.beta]] as const) {
    assert.ok(catalog.projects.some((value: any) => value.id === id));
    const value = JSON.parse(await readFile(join(machineDirectory, 'project-' + id + '.json'), 'utf8'));
    const version = hash(JSON.stringify(value)); // Pinned configs are already normalized; the live API is also checked.
    assert.equal(value.directory, farm.projectPair[kind].identity.directory); assert.equal(value.networkIsolation, 'private');
    assert.equal(version, farm.projectPair[kind].configVersion); assert.ok(distro !== 'alpine' || !Object.keys(value.secrets || {}).length);
    if (distro !== 'alpine' && kind === 'alpha') assert.deepEqual(value.secrets, { FARM_SECRET: 'FarmOwnedSecret' });
  }
  const journalDirectory = join(machineDirectory, 'project-identities'), oldJournals = new Map<string, any>();
  const oldArchiveFiles: Setup['oldArchiveFiles'] = [];
  const archives = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false); const file = join(directory, entry.name);
      if (entry.isDirectory()) await archives(file);
      else { assert.ok(entry.isFile()); oldArchiveFiles.push({ file, sha256: hash(await readFile(file)) }); }
    }
  };
  for (const entry of await readdir(journalDirectory, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false); const file = join(journalDirectory, entry.name);
    if (entry.isDirectory()) await archives(file);
    else if (/^(default|[a-f0-9]{16})\.json$/.test(entry.name)) {
      const value = JSON.parse(await readFile(file, 'utf8')); oldJournals.set(entry.name.slice(0, -5), value);
      assert.ok(value.runs.every((value: any) => value.phase === 'closed'), 'An old journal has unconfirmed work; no automatic recovery is authorized.');
    } else throw new Error('Unknown journal file');
  }
  for (const [kind, id] of [['alpha', selected.alpha], ['beta', selected.beta]] as const) {
    const journal = oldJournals.get(id); assert.ok(journal); assert.deepEqual(journal.identity, farm.projectPair[kind].identity);
  }
  try {
    const file = join(root, 'jobs', 'projects.json'), jobs = await remember(file, undefined, hostFiles);
    assert.ok(jobs.length <= 200 && jobs.every((value: any) => value.status !== 'running'));
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return { workspace, parent, root, machineDirectory, vmId, distro, record, freezeFile, freezeBytes, freeze,
    farm, historicalFiles, secretDirectory, hostFiles, oldJournals, oldArchiveFiles, exactQemu, brokerManifest, originalSelection };
}

async function checkFixture() {
  assert.deepEqual(process.execArgv, ['--import', 'tsx']); assert.equal(process.env.NODE_OPTIONS || '', '');
  const model = new FixtureAgent();
  try { await model.start(); const result = await model.baseline(); console.log(JSON.stringify({ staticOnly: true, vmStarted: false, hostAgent: result })); }
  finally { await model.close(); }
  const sources = { application: applicationPython, observer: observerPython, endpointMutation: replaceEndpointPython,
    rootInitialize: rootInitializePython, stage: stagePython('/workspace/static/ssh-agent-static') };
  const parsed = spawnSync('python', ['-I', '-S', '-c', 'import ast,json,sys\nv=json.load(sys.stdin)\nfor name,source in v.items():ast.parse(source,filename=name)\nprint(json.dumps({"parsed":sorted(v)}))'],
    { input: JSON.stringify(sources), encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(parsed.status, 0, parsed.stdout + parsed.stderr);
  assert.equal('sakura-owned-inert-replacement'.length, 30);
  assert.equal(requiredSources.length, 43);
  assert.equal(/^ssh-agent-project-identity-freeze-[a-f0-9-]{36}\.json$/.test('build-farm-identity-freeze-a5a81891-e6e6-44ab-a268-09a63d865175.json'), false);
  console.log(JSON.stringify({ staticOnly: true, vmStarted: false, ...JSON.parse(parsed.stdout), plannedCases: caseNames.length,
    requiredSources, boundary: 'Host ESM Agent protocol and embedded Python syntax only; no Linux broker or UID claim.' }, null, 2));
}

async function runSmoke(setup: Setup) {
  const { workspace, parent, root, machineDirectory, vmId, distro, farm, freeze, freezeFile, freezeBytes, exactQemu } = setup;
  const invocation = randomUUID(), bodyCanary = 'agent-protected-body-' + invocation;
  const hostScope = join(root, 'ssh-agent-owned-' + invocation), rootOnly = '/run/sakura-owned-agent-' + invocation;
  const proofFile = join(root, 'ssh-agent-project-identity-evidence-' + invocation + '.json');
  const logFile = join(parent, 'ssh-agent-project-identity-' + distro + '-' + invocation + '.log');
  const exitFile = join(parent, 'ssh-agent-project-identity-' + distro + '-' + invocation + '-exit.json');
  const scriptFile = join(workspace, 'scripts', 'smoke-ssh-agent-project-identity.ts');
  const mask = (value: unknown) => String(value).replaceAll(bodyCanary, '[owned body]');
  const proof: any = { version: 1, invocation, fixture: root, vmId, distro, passed: false, phase: 'initializing',
    startedAt: new Date().toISOString(), client: { node: process.version, pid: process.pid, execArgv: process.execArgv,
      noAddonsRequested: false }, frozenStamp: { file: freezeFile, sha256: hash(freezeBytes) },
    sourceSha256: freeze.sourceSha256, scriptSha256: hash(await readFile(scriptFile)), brokerManifest: setup.brokerManifest,
    logFile, exitFile, hostScope, expectedCases: caseNames.length, cases: [], qemuExecutions: [],
    scope: 'Guarded source production Agent forwarder, project UID/native stdin, exact preexisting Farm41 projects; no compiled HTTP, new VM, new account or new migration claim.',
    privateKey: 'One in-memory ephemeral Ed25519 key; no user agent, user key, or persisted private key.',
    secretStore: distro === 'alpine' ? 'No refs in unchanged configs; no Secrets-driver claim.' : 'Exact old independent Farm DPAPI store; read-only, raw ciphertext preserved.',
    previousEvidence: { farmProof: join(root, fixtures[distro].proof), sha256: fixtures[distro].proofSha256,
      files: setup.historicalFiles, attribution: 'Farm and previous results keep their original source and client attribution.' },
    peerBoundary: 'A new connector must match exact UID/cgroup/boot/PID identity. Deliberate relay by an authorized same-UID process is outside this claim.',
    retainedGuestPaths: [{ path: rootOnly, reason: 'New own root observation/replacement backup directory retained as evidence.' }],
    cleanupErrors: [] };
  const log = await open(logFile, 'wx'); await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  process.once('exit', code => writeFileSync(exitFile, JSON.stringify({ version: 1, invocation, actualExitCode: code,
    client: proof.client, proofFile, logFile, at: new Date().toISOString() }) + '\n', { flag: 'wx' }));
  const persist = () => writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
  const line = async (message: string) => { await log.write(mask(message) + '\n'); console.log(mask(message)); };
  const check = async (name: string, action: () => Promise<unknown>) => {
    assert.ok(caseNames.includes(name)); proof.activeCase = { name, startedAt: new Date().toISOString() }; await persist();
    try { const evidence = await action(); proof.cases.push({ ...proof.activeCase, finishedAt: new Date().toISOString(), evidence });
      delete proof.activeCase; await persist(); await line('PASS ' + distro + ' ' + name);
    } catch (error) { proof.failedCase = { ...proof.activeCase, failedAt: new Date().toISOString(), error: mask(error) }; await persist(); throw error; }
  };
  process.env.TEMP = process.env.TMP = parent;
  process.env.SAKURA_DATA_DIR = root; process.env.SAKURA_IMAGE_DIR = join(workspace, '.data', 'images');
  process.env.SAKURA_IMAGE_PATH = join(workspace, '.data', 'images', { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' }[distro]);
  const { Machines } = await import('../server/machines.ts');
  const { createRuntime } = await import('../server/runtime.ts');
  const { Workspaces, projectVersion } = await import('../server/workspaces.ts');
  const { ProjectTerminals, assertProjectTerminalsStopped } = await import('../server/project-terminals.ts');
  const { ProjectRunScopes, projectIdentityTask } = await import('../server/project-run-scope.ts');
  const { ProjectIdentities, projectIdentitySources } = await import('../server/project-identity.ts');
  const { SshAgentForwarder } = await import('../server/ssh-agent-forward.ts');
  const { SshAgentScopes, sshAgentContextSchema, sshAgentRecordSchema, OwnedForwardAgent } = await import('../server/ssh-agent-scope.ts');
  const { Secrets } = await import('../server/secrets.ts');
  const { Jobs } = await import('../server/jobs.ts');
  const { AppError } = await import('../server/model.ts');
  const packaged = await projectIdentitySources(); proof.packagedIdentityManifest = packaged.manifest;
  await mkdir(hostScope); await persist();
  const runtime = await createRuntime(), nativeRun = runtime.run.bind(runtime);
  runtime.run = (async (...call: Parameters<typeof nativeRun>) => {
    if (call[0] !== 'sakura-qemu' || !call[1].some(value => value.includes(root))) return nativeRun(...call);
    assert.ok(call[1].some(value => value.includes(vmId)));
    const receipt: any = { startedAt: new Date().toISOString(), settled: false, argvSha256: hash(JSON.stringify(call[1])) };
    proof.qemuExecutions.push(receipt);
    try { return await nativeRun(...call); } finally { receipt.settled = true; receipt.finishedAt = new Date().toISOString(); }
  }) as typeof runtime.run;
  const machines = new Machines(runtime); await machines.init();
  assert.equal(machines.records.size, 1); assert.equal(machines.state(vmId), 'stopped'); assert.equal(machines.live.size, 0);
  const secrets = new Secrets(machines, undefined, setup.secretDirectory);
  const spaces = new Workspaces(machines, { secrets }); await spaces.jobs.close();
  spaces.jobs = new Jobs('owned-agent', join(hostScope, 'jobs'));
  let terminals = new ProjectTerminals(machines, spaces);
  const neighborTerminals = new ProjectTerminals(machines, spaces);
  const core = new ProjectIdentities(machines), accounts = new ProjectRunScopes(machines), resources = new SshAgentScopes(machines);
  const ownAgent = new FixtureAgent(), originalAgentSocket = process.env.SSH_AUTH_SOCK;
  process.env.SSH_AUTH_SOCK = ownAgent.pipe;
  const nativeExec = machines.exec.bind(machines), nativeInput = machines.execInput.bind(machines);
  const commandReceipts: { sha256: string; bodyAbsent: boolean; forwarded: boolean }[] = [];
  type Running = { label: string; projectId: string; controller: AbortController; settled: boolean;
    completion: Promise<{ result?: Awaited<ReturnType<InstanceType<typeof SshAgentForwarder>['run']>>; error?: unknown }>;
    context?: SshAgentContext; agent?: OwnedForwardAgent; run?: ProjectIdentityRun; reports?: any[]; record?: any; stoppedRecord?: any };
  const running = new Map<string, Running>(), contexts = new Map<string, SshAgentContext>();
  const contextOwners = new Map<string, OwnedForwardAgent>();
  const transportReceipts: any[] = [], ownedRunIds = new Map<string, Set<string>>();
  proof.originalFrameObservations = transportReceipts;
  let bootId = '', baseline: any, alpha: Awaited<ReturnType<InstanceType<typeof Workspaces>['config']>>, beta: typeof alpha;
  const alphaId = fixtures[distro].alpha, betaId = fixtures[distro].beta;
  const alphaIdentity: ProjectIdentity = farm.projectPair.alpha.identity, betaIdentity: ProjectIdentity = farm.projectPair.beta.identity;
  const childFor = (id: string) => (id === alphaId ? alphaIdentity : betaIdentity).directory + '/ssh-agent-' + invocation;
  const identityFor = (id: string) => id === alphaId ? alphaIdentity : betaIdentity;
  const inScope = <T>(id: string, action: () => Promise<T>) => spaces.projects.inScope(vmId, id, action);
  const journal = async (id: string) => JSON.parse(await readFile(join(machineDirectory, 'project-identities', id + '.json'), 'utf8'));
  const decode = (command: string) => {
    if (!command.includes('# SAKURA_SSH_AGENT_')) return null;
    for (const token of command.match(/[A-Za-z0-9+/]{60,}={0,2}/g) || []) {
      if (token.length > 131072) continue;
      try {
        const value = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
        if (!['run', 'cleanup', 'read'].includes(value.action)) continue;
        const context = sshAgentContextSchema.parse(value.context); return { action: value.action, context, launcher: value.launcher };
      } catch { /* Only a complete strict fixed metadata request is recognized. */ }
    }
    return null;
  };
  const recordCommand = (command: string, forwarded = false) => {
    const absent = ![bodyCanary, Buffer.from(bodyCanary).toString('base64')].some(value => command.includes(value));
    assert.equal(absent, true, 'A root argv contains the new project body.');
    commandReceipts.push({ sha256: hash(command), bodyAbsent: absent, forwarded });
  };
  const observe = async (request: object) => {
    const input = Buffer.from(JSON.stringify(request)); assert.ok(input.length <= 131072);
    const result = await nativeInput(vmId, fixed + py(observerPython), input, 60000);
    assert.equal(result.code, 0, mask(result.stdout + result.stderr)); assert.equal(result.stderr, '');
    assert.ok(Buffer.byteLength(result.stdout) <= 2 * 1024 * 1024); return JSON.parse(result.stdout);
  };
  const mutate = async (request: object, source = replaceEndpointPython) => {
    const result = await nativeInput(vmId, fixed + py(source), Buffer.from(JSON.stringify(request)), 10000);
    assert.equal(result.code, 0, mask(result.stdout + result.stderr)); assert.equal(result.stderr, ''); return JSON.parse(result.stdout);
  };
  const fault = { enabled: false, run: undefined as Running | undefined, attempts: 0, firstConfirmedAt: '' };
  const readyFault = { label: '', used: false };
  let launchingLabel = '';
  machines.execInput = (async (...call: Parameters<typeof nativeInput>) => {
    const request = decode(call[1]); recordCommand(call[1], Boolean(request?.action === 'run'));
    if (request?.action === 'run') {
      const context = request.context; assert.equal(call[0], vmId); assert.equal(context.owner.bootId, bootId);
      assert.deepEqual(context.identity, identityFor(context.identity.projectId));
      assert.equal(context.resource.brokerSha256, setup.brokerManifest.sha256);
      assert.equal(hash(call[2]), context.sha256, 'The original native stdin frame must remain unchanged.');
      assert.ok(call[6] instanceof OwnedForwardAgent); assert.ok(call[4]);
      contexts.set(context.owner.runId, context); contextOwners.set(context.owner.runId, call[6]);
      const label = launchingLabel; assert.ok(label && running.has(label));
      running.get(label)!.context = context; running.get(label)!.agent = call[6];
      transportReceipts.push({ label, context, frameSize: call[2].length, frameSha256: hash(call[2]),
        commandSha256: hash(call[1]), unchangedInput: true, actualOwnedAgent: true });
      await persist();
      if (readyFault.label === label) {
        assert.equal(readyFault.used, false);
        const needle = 'SAKURA_SSH_AGENT_SOURCE="${SSH_AUTH_SOCK-}"';
        assert.equal(call[1].split(needle).length, 2, 'Only the same RUN source capture may be faulted.');
        call[1] = call[1].replace(needle, 'SAKURA_SSH_AGENT_SOURCE=""');
        assert.deepEqual(decode(call[1]), request); assert.equal(hash(call[2]), context.sha256); readyFault.used = true;
      }
      launchingLabel = '';
    }
    return nativeInput(...call);
  }) as typeof machines.execInput;
  machines.exec = (async (...call: Parameters<typeof nativeExec>) => {
    recordCommand(call[1]); const request = decode(call[1]);
    if (request?.action === 'cleanup') {
      assert.equal(call[5], undefined, 'Cleanup must not carry a host agent.');
      if (fault.enabled && fault.run?.context && request.context.resource.leaseId === fault.run.context.resource.leaseId) {
        assert.deepEqual(request.context, fault.run.context); assert.ok(fault.run.run && fault.run.reports);
        const stopped = await observe({ operation: 'scope', bootId, run: fault.run.run, reports: fault.run.reports });
        assert.equal(stopped.cgroupExists, false); assert.ok(stopped.processes.every((value: any) => !value.alive));
        assert.equal(stopped.control.owner.bootId, bootId); assert.equal(machines.live.get(vmId), capturedLive);
        fault.firstConfirmedAt ||= new Date().toISOString(); fault.attempts++;
        throw new AppError('Own stopped Agent resource cleanup confirmation connection unavailable', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      }
    }
    return nativeExec(...call);
  }) as typeof machines.exec;
  let capturedLive: ReturnType<typeof machines.live.get>, heldLease: Awaited<ReturnType<typeof neighborTerminals.prepare>> | undefined;
  const readyPaths = Object.keys(farm.originalGuestBaseline.readyTrees);
  const validateReport = (report: any, identity: ProjectIdentity) => {
    assert.equal(report.uid, identity.uid); assert.equal(report.euid, identity.uid); assert.equal(report.gid, identity.gid);
    assert.deepEqual(report.groups, []); assert.equal(report.home, identity.home); assert.equal(report.cwd, identity.directory);
    assert.equal(report.bootId, bootId); assert.equal(report.noNewPrivs, '1'); assert.equal(report.bodyPresent, true);
    assert.equal(report.rootWriteDenied, true); for (const value of Object.values(report.caps)) assert.match(String(value), /^0+$/);
    assert.equal(report.descriptors.some((value: any) => /\/sys\/fs\/cgroup(?:\/|$)|\/(?:run|var\/lib)\/(?:sakura-project-identities|sakura-guest-tasks)(?:\/|$)/.test(value.target)), false);
  };
  const validateSignature = (report: any) => {
    assert.equal(report.keySha256 ?? hash(ownAgent.blob), hash(ownAgent.blob));
    assert.equal(verify(null, Buffer.from(report.challenge), ownAgent.publicKey, Buffer.from(report.signature, 'base64')), true);
    assert.equal(ownAgent.hasSigned(report.challenge), true);
  };
  const command = (id: string, mode: string, label: string, extra: string[] = []) =>
    'AGENT_BODY=' + quote(bodyCanary) + ' /usr/bin/python3 -I -S ' + quote(childFor(id) + '/fixture.py') + ' ' +
    [mode, label, hash(bodyCanary), rootOnly, ownAgent.blob.toString('base64'), ownAgent.challengePrefix, ...extra].map(quote).join(' ');
  const collectRuns = async (id: string) => {
    const current = await journal(id), old = setup.oldJournals.get(id); assert.ok(old);
    const set = ownedRunIds.get(id) || new Set<string>();
    for (const entry of current.runs) if (!old.runs.some((value: any) => value.runId === entry.runId)) {
      assert.equal(entry.owner.kind, 'task'); assert.equal(entry.owner.bootId, bootId); set.add(entry.runId);
    }
    ownedRunIds.set(id, set); return current;
  };
  const uidTask = async (id: string, command: string) => {
    const prepared = await terminals.prepare(vmId, id, null, false, undefined, undefined, { mode: 'task' });
    try {
      assert.ok(prepared.captured && prepared.signal);
      assert.equal(prepared.captured.live, capturedLive);
      const project = await spaces.resolveProject(vmId, prepared.captured.project);
      const result = await projectIdentityTask(machines, vmId, project, { command, environment: project.environment }, prepared.signal,
        undefined, 30000, undefined, undefined, { expectedLive: capturedLive });
      assert.equal(result.code, 0, mask(result.stdout + result.stderr)); assert.equal(result.stderr, '');
      const current = await collectRuns(id);
      assert.ok(current.runs.filter((entry: any) => !setup.oldJournals.get(id).runs.some((old: any) => old.runId === entry.runId) && !entry.sshAgent)
        .every((entry: any) => entry.phase === 'closed' && entry.run?.phase === 'closed'));
      return result;
    } finally { prepared.release(); }
  };
  const begin = (id: string, label: string, mode = 'hang', owner = terminals): Running => {
    assert.ok(!running.has(label)); assert.equal(launchingLabel, '', 'Await each RUN metadata capture before starting the next.');
    const controller = new AbortController(), value: Running = { label, projectId: id, controller, settled: false, completion: Promise.resolve({}) };
    running.set(label, value); launchingLabel = label;
    const forwarder = new SshAgentForwarder(machines, { workspaces: spaces, terminals: owner });
    value.completion = inScope(id, () => forwarder.run(vmId, { command: command(id, mode, label), confirmed: true, timeoutSeconds: 180 }, controller.signal))
      .then(result => ({ result }), error => ({ error })).finally(() => { value.settled = true; if (launchingLabel === label) launchingLabel = ''; });
    return value;
  };
  const active = async (value: Running) => {
    const identity = identityFor(value.projectId), deadline = Date.now() + 60000;
    const suffixes = ['leader', 'newgroup', 'setsid', 'doublefork'];
    const paths = suffixes.map(suffix => childFor(value.projectId) + '/' + value.label + '-' + suffix + '.json');
    while (Date.now() < deadline) {
      if (value.settled) { const result = await value.completion; throw new Error('Owned Agent task settled before active markers: ' + mask(result.error || result.result)); }
      const result = await observe({ operation: 'markers', bootId, uid: identity.uid, paths });
      if (!result.complete || result.reports.length !== 4) { await delay(100); continue; }
      assert.ok(value.context && value.agent); const context = value.context;
      const entry = (await collectRuns(value.projectId)).runs.find((entry: any) => entry.runId === context.owner.runId); assert.ok(entry);
      assert.deepEqual(entry.identity, identity); assert.deepEqual(entry.sshAgent, context.resource); assert.equal(entry.sha256, context.sha256);
      const run = await core.runReadonly(vmId, identity, context.owner.runId); assert.equal(run.phase, 'active');
      const resource = await resources.readonly(vmId, context); assert.equal(resource.phase, 'ready');
      const record = sshAgentRecordSchema.parse(resource.record); assert.equal(record.scope.device, run.cgroupDevice); assert.equal(record.scope.inode, run.cgroupInode);
      assert.equal(record.endpointDirectory!.uid, 0); assert.equal(record.endpointDirectory!.gid, identity.gid); assert.equal(record.endpointDirectory!.mode, 0o710);
      assert.equal(record.endpoint!.uid, identity.uid); assert.equal(record.endpoint!.gid, identity.gid); assert.equal(record.endpoint!.mode, 0o600);
      assert.equal(record.endpoint!.type, 0o140000); assert.ok(record.source && record.broker);
      assert.equal(record.source.socket.uid, 0); assert.equal(record.source.parent.mode, 0o700);
      for (const report of result.reports) {
        validateReport(report, identity); validateSignature(report); assert.equal(report.observed.alive, true);
        assert.equal(report.observed.uid, identity.uid); assert.equal(report.observed.cgroup, report.cgroup);
        assert.equal(report.cgroup, '0::/sakura-task-' + context.owner.runId);
        assert.equal(report.networkDevice, run.networkDevice); assert.equal(report.networkInode, run.networkInode);
        assert.equal(report.agentSocket, '/run/sakura-agent-sockets/' + context.resource.leaseId + '/agent');
        assert.notEqual(report.agentSocket, record.source.path);
      }
      value.run = run; value.reports = result.reports; value.record = record;
      proof.ownedActiveRuns ||= []; proof.ownedActiveRuns.push({ label: value.label, context, run, record, reports: result.reports }); await persist();
      assert.equal(ownAgent.liveFor(value.label), 4); assert.equal(value.agent.streamCount, 4);
      return { context, run, record, reports: result.reports };
    }
    throw new Error('Owned Agent markers deadline exceeded: ' + value.label);
  };
  const stopped = async (value: Running, controlRetained = false) => {
    assert.ok(value.context && value.run && value.reports && value.agent);
    const result = await observe({ operation: 'scope', bootId, run: value.run, reports: value.reports });
    assert.equal(result.cgroupExists, false); assert.ok(result.processes.every((value: any) => !value.alive));
    const run = await core.runReadonly(vmId, identityFor(value.projectId), value.context.owner.runId);
    assert.equal(run.phase, 'closed'); assert.deepEqual({ ...run, phase: 'active' }, value.run);
    const entry = (await journal(value.projectId)).runs.find((entry: any) => entry.runId === run.runId); assert.ok(entry);
    assert.equal(entry.phase, 'closed'); assert.deepEqual(entry.run, run); assert.deepEqual(entry.sshAgent, value.context.resource);
    const closed = await resources.readonly(vmId, value.context); assert.equal(closed.phase, 'closed');
    const resource = await observe({ operation: 'resource', bootId, context: value.context });
    assert.equal(resource.endpointDirectory, null); assert.equal(resource.endpoint, null);
    assert.equal(resource.sourceSocketPresent, false); assert.equal(resource.brokerProcess.alive, false); assert.equal(resource.sourceProcess.alive, false);
    assert.equal(value.agent.streamCount, 0); assert.equal(ownAgent.liveFor(value.label), 0);
    assert.equal(result.control.exists, controlRetained);
    return { ...result, run, resource, originalRecordUnchangedExceptPhase: closed.record ?
      JSON.stringify({ ...closed.record, phase: value.record.phase }) === JSON.stringify(value.record) : false };
  };
  const cancel = async (value: Running) => { value.controller.abort(); const result = await value.completion;
    assert.ok(result.error || result.result?.code !== 0, 'A hanging command unexpectedly completed successfully'); return { resultCode: result.result?.code, error: result.error ? mask(result.error) : undefined }; };
  const exactRecord = (value: Running) => {
    assert.ok(value.context && value.run && value.reports && value.record && value.stoppedRecord);
    return { context: value.context, run: value.run, reports: value.reports,
      activeRecord: value.record, record: value.stoppedRecord, rootOnly };
  };
  let first: Running | undefined, second: Running | undefined, broken: Running | undefined, terminalTask: Running | undefined;
  let replacement: any;
  try {
    await check(caseNames[0], async () => {
      await ownAgent.start(); proof.ownedHostAgent = { pipe: ownAgent.pipe, privateKeyPersisted: false, publicKeySha256: hash(ownAgent.blob) };
      const host = await ownAgent.baseline(); await machines.start(vmId);
      const deadline = Date.now() + 180000;
      while (machines.state(vmId) !== 'running') { assert.ok(Date.now() < deadline); await delay(300); }
      await machines.connect(vmId); capturedLive = machines.live.get(vmId); assert.ok(capturedLive);
      const boot = await nativeExec(vmId, fixed + '/bin/cat /proc/sys/kernel/random/boot_id', 10000);
      assert.equal(boot.code, 0); bootId = boot.stdout.trim(); assert.match(bootId, uuidPattern); assert.notEqual(bootId, farm.bootId);
      proof.bootId = bootId; proof.identityBuild = await core.install(vmId); assert.equal(proof.identityBuild, packaged.manifest.build);
      baseline = await observe({ operation: 'baseline', bootId, readyPaths }); proof.originalGuestBaseline = baseline;
      const inspectedPair: Record<string, ProjectIdentity> = {};
      for (const value of [farm.projectPair.alpha, farm.projectPair.beta]) {
        const identity = await core.inspect(vmId, value.id); assert.ok(identity); inspectedPair[value.id] = identity;
      }
      const farmBaselineAuthority = assertFarmGuestBaseline(baseline, farm, inspectedPair);
      proof.farmBaselineAuthority = farmBaselineAuthority;
      await mutate({ rootOnly }, rootInitializePython);
      return { host, bootId, defaultClient: proof.client, oldAssetsAndAccountsUnchanged: true, noNewDisk: true, farmBaselineAuthority };
    });
    await check(caseNames[1], async () => {
      assert.deepEqual(await spaces.projects.list(vmId), setup.originalSelection);
      alpha = await inScope(alphaId, () => spaces.config(vmId)); beta = await inScope(betaId, () => spaces.config(vmId));
      assert.equal(projectVersion(alpha), farm.projectPair.alpha.configVersion); assert.equal(projectVersion(beta), farm.projectPair.beta.configVersion);
      assert.deepEqual(await core.inspect(vmId, alphaId), alphaIdentity); assert.deepEqual(await core.inspect(vmId, betaId), betaIdentity);
      if (distro !== 'alpine') { assert.equal((await spaces.resolveProject(vmId, alpha)).environment?.FARM_SECRET?.length! > 12, true); }
      return { projectPair: farm.projectPair, newAccountsClaimed: false, newMigrationsClaimed: false, secretStoreReadOnly: true };
    });
    await check(caseNames[2], async () => {
      const stages = [];
      for (const id of [alphaId, betaId]) {
        const staged = await uidTask(id, py(stagePython(childFor(id))));
        const output = JSON.parse(staged.stdout); assert.equal(output.uid, identityFor(id).uid); assert.equal(output.programSha256, hash(applicationPython));
        stages.push({ projectId: id, child: childFor(id), ...output });
        proof.retainedGuestPaths.push({ path: childFor(id), reason: 'Only new project UID fixture/markers; original project binding unchanged.' });
      }
      return { stages, projectDirectories: [alphaIdentity.directory, betaIdentity.directory], noRootProjectBody: true };
    });
    await check(caseNames[3], async () => {
      const once = begin(alphaId, 'stock-client', 'once'); const result = await once.completion;
      assert.equal(result.error, undefined, mask(result.error)); assert.ok(result.result); assert.equal(result.result.code, 0); assert.equal(result.result.ready, true);
      const report = JSON.parse(result.result.stdout); validateReport(report, alphaIdentity); validateSignature(report);
      assert.equal(result.result.projectId, alphaId); assert.equal(result.result.configVersion, farm.projectPair.alpha.configVersion);
      assert.ok(once.context); const entry = (await collectRuns(alphaId)).runs.find((entry: any) => entry.runId === once.context!.owner.runId);
      assert.equal(entry.phase, 'closed'); assert.equal(entry.run.phase, 'closed');
      const resource = await resources.readonly(vmId, once.context); assert.equal(resource.phase, 'closed');
      return { report, exactContext: once.context, originalFrame: transportReceipts.find(value => value.label === once.label), stockSshAddVerified: true };
    });
    await check(caseNames[4], async () => {
      first = begin(alphaId, 'slot-a'); const a = await active(first);
      second = begin(alphaId, 'slot-b'); const b = await active(second);
      assert.notEqual(a.context.owner.runId, b.context.owner.runId); assert.notEqual(a.context.resource.leaseId, b.context.resource.leaseId);
      assert.notEqual(a.record.source!.path, b.record.source!.path); assert.notEqual(a.record.source!.peer.pid, b.record.source!.peer.pid);
      const ns = await observe({ operation: 'namespace', bootId, projectId: alphaId });
      assert.equal(a.run.networkInode, ns.private.inode); assert.notEqual(a.run.networkInode, ns.host.inode);
      assert.ok(a.reports.every((report: any) => report.observed.alive) && b.reports.every((report: any) => report.observed.alive));
      assert.notEqual(a.reports[1].pgid, a.reports[0].pgid); assert.equal(a.reports[2].sid, a.reports[2].pid);
      assert.notEqual(a.reports[3].sid, a.reports[3].pid); assert.throws(() => assertProjectTerminalsStopped(machines, vmId, alphaId));
      return { a, b, eightLiveClients: ownAgent.liveFor('slot-a') + ownAgent.liveFor('slot-b'), sameOriginalIdentity: true, namespace: ns };
    });
    await check(caseNames[5], async () => {
      assert.ok(first?.reports && first.context); const target = first.reports[0];
      const result = await uidTask(alphaId, command(alphaId, 'attack', 'same-uid-outsider',
        [target.agentSocket, String(target.pid), target.ticks, childFor(alphaId) + '/fixture.py']));
      const value = JSON.parse(result.stdout); validateReport(value, alphaIdentity); assert.equal(value.agentAccepted, false);
      assert.equal(value.challenge, ownAgent.challenge('same-uid-outsider', 'leader', 'forbidden'));
      assert.equal(ownAgent.hasSigned(value.challenge), false); assert.notEqual(value.cgroup, target.cgroup);
      return { report: value, hostAgentSawForbiddenSign: false, connectorScopeRefused: true };
    });
    await check(caseNames[6], async () => {
      assert.ok(first?.reports); const target = first.reports[0];
      const result = await uidTask(betaId, command(betaId, 'attack', 'other-project-outsider',
        [target.agentSocket, String(target.pid), target.ticks, childFor(alphaId) + '/fixture.py']));
      const value = JSON.parse(result.stdout); validateReport(value, betaIdentity); assert.equal(value.agentAccepted, false);
      assert.equal(value.environmentDenied, true); assert.equal(value.descriptorsDenied, true); assert.equal(value.scriptDenied, true);
      assert.equal(value.foreignArgvContainsBody, false); assert.equal(ownAgent.hasSigned(value.challenge), false);
      const rootArgv = await observe({ operation: 'root-argv', bootId, needles: [bodyCanary, Buffer.from(bodyCanary).toString('base64')] });
      assert.deepEqual(rootArgv.matchingRootPids, []); proof.rootArgvBodyAbsent = true;
      return { report: value, rootArgv, foreignProjectSigned: false };
    });
    await check(caseNames[7], async () => {
      assert.ok(first && second?.run && second.reports); await cancel(first); const closed = await stopped(first);
      const alive = await observe({ operation: 'scope', bootId, run: second.run, reports: second.reports });
      assert.equal(alive.cgroupExists, true); assert.ok(alive.processes.every((value: any) => value.alive));
      assert.equal(second.settled, false); assert.equal(ownAgent.liveFor('slot-b'), 4); assert.equal(second.agent!.streamCount, 4);
      assert.throws(() => assertProjectTerminalsStopped(machines, vmId, alphaId));
      return { closed, neighbor: alive, neighborAgentStreams: second.agent!.streamCount };
    });
    await check(caseNames[8], async () => {
      assert.ok(second); const path = childFor(alphaId) + '/slot-b-resign.request';
      await uidTask(alphaId, py('import os\nfd=os.open(' + JSON.stringify(path) + ',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)\nos.close(fd)'));
      const deadline = Date.now() + 12000; let report: any;
      while (Date.now() < deadline) {
        const result = await observe({ operation: 'markers', bootId, uid: alphaIdentity.uid, paths: [childFor(alphaId) + '/slot-b-resigned.json'] });
        if (result.complete) { report = result.reports[0]; break; } await delay(100);
      }
      assert.ok(report); assert.equal(report.challenge, ownAgent.challenge('slot-b', 'leader', 'after-revocation')); validateSignature(report);
      assert.equal(report.observed.alive, true); return { report, firstStreams: first!.agent!.streamCount, secondStreams: second.agent!.streamCount };
    });
    await check(caseNames[9], async () => { assert.ok(second); await cancel(second); return stopped(second); });
    await check(caseNames[10], async () => {
      readyFault.label = 'ready-denied'; const value = begin(alphaId, readyFault.label); const result = await value.completion;
      assert.equal(readyFault.used, true); assert.ok(result.error instanceof AppError);
      assert.equal(result.error.code, 'PROJECT_IDENTITY_SSH_AGENT_SOURCE_INVALID'); assert.ok(value.context);
      const observed = await observe({ operation: 'resource', bootId, context: value.context });
      assert.equal(observed.record.phase, 'closed'); assert.equal(observed.record.failure, 'SOURCE_INVALID');
      assert.equal(observed.record.source, null); assert.equal(observed.endpointDirectory, null);
      const markerPaths = ['entered', 'leader'].map(suffix => childFor(alphaId) + '/' + readyFault.label + '-' + suffix + '.json');
      const marker = await observe({ operation: 'paths', bootId, paths: markerPaths });
      assert.ok(Object.values(marker.paths).every(value => value === null));
      const entry = (await collectRuns(alphaId)).runs.find((entry: any) => entry.runId === value.context!.owner.runId);
      assert.equal(entry.phase, 'closed'); assert.equal(entry.run, null);
      await assert.rejects(core.runReadonly(vmId, alphaIdentity, value.context.owner.runId), (error: unknown) => error instanceof AppError && error.code === 'PROJECT_IDENTITY_RECORD_ABSENT');
      return { context: value.context, observed, nativeTicketAbsent: true, bodyMarkerPaths: markerPaths,
        firstBodyWriteAndSignedMarkerAbsent: true, errorCode: result.error.code, unchangedFrame: true };
    });
    await check(caseNames[11], async () => {
      broken = begin(alphaId, 'cleanup-unconfirmed'); await active(broken); fault.run = broken; fault.enabled = true;
      broken.controller.abort(); const result = await broken.completion;
      assert.ok(result.error instanceof AppError); assert.equal(result.error.status, 503); assert.equal(result.error.code, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      assert.ok(fault.attempts >= 3); assert.ok(fault.firstConfirmedAt);
      const scope = await observe({ operation: 'scope', bootId, run: broken.run, reports: broken.reports });
      assert.equal(scope.cgroupExists, false); assert.ok(scope.processes.every((value: any) => !value.alive)); assert.equal(scope.control.exists, true);
      const resource = await observe({ operation: 'resource', bootId, context: broken.context, rootOnly });
      assert.equal(resource.brokerProcess.alive, false); assert.equal(resource.sourceProcess.alive, false);
      assert.equal(resource.sourceSocketPresent, false); assert.equal(broken.agent!.streamCount, 0); assert.equal(ownAgent.liveFor(broken.label), 0);
      const originalReadyRecord = sshAgentRecordSchema.parse(broken.record);
      const afterStopReceipt = sshAgentRecordSchema.parse(resource.record);
      assert.equal(originalReadyRecord.phase, 'ready'); assert.equal(originalReadyRecord.failure, null);
      const immutable = (value: typeof originalReadyRecord) => {
        const { phase: _phase, failure: _failure, ...tuple } = value; return tuple;
      };
      assert.deepEqual(immutable(afterStopReceipt), immutable(originalReadyRecord));
      if (afterStopReceipt.phase === 'ready') assert.equal(afterStopReceipt.failure, null);
      else {
        assert.equal(afterStopReceipt.phase, 'failed'); assert.match(afterStopReceipt.failure || '', /^[A-Z][A-Z0-9_]{0,79}$/);
      }
      broken.stoppedRecord = afterStopReceipt;
      const run = await core.runReadonly(vmId, alphaIdentity, broken.context!.owner.runId); assert.equal(run.phase, 'active');
      const entry = (await journal(alphaId)).runs.find((entry: any) => entry.runId === run.runId); assert.notEqual(entry.phase, 'closed');
      await assert.rejects(accounts.withLock(vmId, alphaId, access => access.guard()), (error: unknown) => error instanceof AppError && error.code === 'PROJECT_IDENTITY_RUNS_MUST_STOP');
      proof.retainedControlEvidence = scope.control;
      proof.retainedGuestPaths.push({ path: scope.control.directory, reason: 'Actual afterCleanup failure retains the original root control identity; account recovery does not claim its retirement.' });
      return { errorCode: result.error.code, status: result.error.status, attempts: fault.attempts, firstOuterConfirmedAt: fault.firstConfirmedAt,
        scope, resource, originalReadyRecord, afterStopReceipt, immutableTupleUnchanged: true, nativeStillOpen: run, immutableEntry: entry };
    });
    await check(caseNames[12], async () => {
      assert.ok(broken); fault.enabled = false;
      const original = await observe({ operation: 'resource', bootId, context: broken.context, rootOnly });
      assert.deepEqual(original.record, broken.stoppedRecord);
      replacement = await mutate({ ...exactRecord(broken), rootInfo: original.rootInfo, action: 'replace' });
      proof.retainedReplacement = { ...replacement, restored: false }; await persist();
      await assert.rejects(accounts.recoverStoppedTasks(vmId, alphaId), (error: unknown) => error instanceof AppError && error.status === 503 && error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED');
      const changed = await observe({ operation: 'resource', bootId, context: broken.context });
      assert.deepEqual(changed.endpoint, replacement.replacement); assert.deepEqual(changed.record, broken.stoppedRecord);
      const run = await core.runReadonly(vmId, alphaIdentity, broken.context!.owner.runId); assert.equal(run.phase, 'active');
      return { exactReplacement: replacement, refusalCode: 'PROJECT_IDENTITY_CLEANUP_FAILED', untouchedReplacement: changed.endpoint,
        unchangedRecord: true, nativeStillActive: true };
    });
    await check(caseNames[13], async () => {
      assert.ok(broken && replacement);
      const original = await observe({ operation: 'resource', bootId, context: broken.context, rootOnly });
      const restored = await mutate({ ...exactRecord(broken), rootInfo: original.rootInfo, action: 'restore', replacement: replacement.replacement });
      proof.retainedReplacement.restored = true; replacement = undefined; await persist();
      await accounts.recoverStoppedTasks(vmId, alphaId); const closed = await stopped(broken, true);
      assert.deepEqual(closed.control, proof.retainedControlEvidence);
      return { restored, closed, normalProductionRecovery: true, retainedOriginalRootControl: true };
    });
    await check(caseNames[14], async () => {
      heldLease = await neighborTerminals.prepare(vmId, betaId, null, false, undefined, undefined, { mode: 'task' });
      terminalTask = begin(alphaId, 'terminal-close'); await active(terminalTask);
      const closing = terminals.close(); await terminalTask.completion; await closing;
      const closed = await stopped(terminalTask); assert.throws(() => assertProjectTerminalsStopped(machines, vmId, betaId));
      heldLease.release(); heldLease = undefined; assertProjectTerminalsStopped(machines, vmId, betaId);
      terminals = new ProjectTerminals(machines, spaces);
      return { closed, otherTerminalLeasePreserved: true, newTerminalOwnerConstructedAfterClose: true };
    });
    await check(caseNames[15], async () => {
      const reloaded = new SshAgentScopes(machines), identities = new ProjectRunScopes(machines), before = contexts.size;
      const values = [];
      for (const [runId, context] of contexts) {
        const result = await reloaded.readonly(vmId, context); assert.equal(result.phase, 'closed');
        const entry = (await journal(context.identity.projectId)).runs.find((entry: any) => entry.runId === runId); assert.equal(entry.phase, 'closed');
        assert.equal(await identities.readonlyActive(vmId, context.identity.projectId, runId), false);
        values.push({ runId, leaseId: context.resource.leaseId, phase: result.phase, recordSha256: hash(JSON.stringify(result.record)) });
      }
      assert.equal(contexts.size, before); return { records: values, newRunOrResourceIssued: false, originalResourcesReadOnly: true };
    });
  } catch (error) { proof.error = mask(error); await persist(); await line('FAIL ' + mask(error)); }
  finally {
    fault.enabled = false;
    const cleanupError = (step: string, error: unknown) => proof.cleanupErrors.push({ step, error: mask(error) });
    for (const value of running.values()) if (!value.settled) value.controller.abort();
    await Promise.allSettled([...running.values()].map(value => value.completion));
    if (capturedLive && machines.live.get(vmId) === capturedLive && machines.state(vmId) === 'running') {
      if (replacement && broken?.context && broken.run && broken.reports && broken.record) {
        try {
          const original = await observe({ operation: 'resource', bootId, context: broken.context, rootOnly });
          await mutate({ ...exactRecord(broken), rootInfo: original.rootInfo, action: 'restore', replacement: replacement.replacement });
          proof.retainedReplacement.restored = true; replacement = undefined;
        } catch (error) { cleanupError('Only exact stopped own replacement restore', error); }
      }
      try {
        for (const id of [alphaId, betaId]) {
          await collectRuns(id);
          const current = await journal(id), old = setup.oldJournals.get(id);
          for (const entry of current.runs.filter((entry: any) => entry.phase !== 'closed')) {
            assert.ok(!old.runs.some((value: any) => value.runId === entry.runId));
            assert.ok(ownedRunIds.get(id)?.has(entry.runId));
            if (entry.run) {
              const observed = await observe({ operation: 'scope', bootId, run: entry.run }); assert.equal(observed.cgroupExists, false);
            }
          }
          await accounts.recoverStoppedTasks(vmId, id);
        }
        for (const value of running.values()) if (value.run) {
          const allowControl = value === broken;
          proof.finalOwnedScopes ||= []; proof.finalOwnedScopes.push({ label: value.label, ...await stopped(value, allowControl) });
        }
      } catch (error) { cleanupError('Exact own stopped resource and account recovery', error); }
      try {
        const current = await observe({ operation: 'baseline', bootId, readyPaths }); assert.deepEqual(current, baseline);
        proof.originalAccountsBindingsAndReadyAssetsUnchanged = true;
        const catalog = await spaces.projects.list(vmId); assert.deepEqual(catalog, setup.originalSelection);
        proof.originalSelectionRestored = true;
      } catch (error) { cleanupError('Original guest/selection preservation', error); }
      try { const result = await nativeExec(vmId, fixed + '/bin/sync', 10000); assert.equal(result.code, 0); proof.syncedBeforeStopAt = new Date().toISOString(); }
      catch (error) { cleanupError('Owned sync', error); }
    }
    machines.exec = nativeExec; machines.execInput = nativeInput;
    heldLease?.release();
    for (const [step, action] of [['Terminal close', () => terminals.close()], ['Neighbor terminal close', () => neighborTerminals.close()],
      ['Workspace close', () => spaces.close()], ['Owned Agent close', () => ownAgent.close()], ['Machines close', () => machines.close()]] as const) {
      try { await action(); } catch (error) { cleanupError(step, error); }
    }
    if (originalAgentSocket === undefined) delete process.env.SSH_AUTH_SOCK; else process.env.SSH_AUTH_SOCK = originalAgentSocket;
    proof.vmStopped = machines.state(vmId) === 'stopped'; proof.liveEntries = machines.live.size;
    proof.ownedQemuSettled = proof.qemuExecutions.every((value: any) => value.settled); proof.exactQemuMatches = exactQemu();
    proof.independentCimObservedAt = new Date().toISOString(); proof.stoppedAt = new Date().toISOString();
    try {
      const records = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8')); assert.equal(records.length, 1);
      const stable = (value: any) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'lastUsedAt'));
      assert.deepEqual(stable(records[0]), stable(setup.record)); proof.originalMachineRecordUnchangedExceptLastUsedAt = true;
      for (const file of [...setup.historicalFiles, ...setup.hostFiles, ...setup.oldArchiveFiles]) assert.equal(hash(await readFile(file.file)), file.sha256, file.file);
      for (const [id, old] of setup.oldJournals) {
        const current = await journal(id);
        if ([alphaId, betaId].includes(id as typeof alphaId)) {
          const { runs: oldRuns, ...oldMeta } = old, { runs: currentRuns, ...meta } = current; assert.deepEqual(meta, oldMeta);
          for (const entry of oldRuns) {
            const value = currentRuns.find((value: any) => value.runId === entry.runId) || JSON.parse(await readFile(join(machineDirectory, 'project-identities', id, 'closed-runs', entry.runId + '.json'), 'utf8'));
            assert.equal(JSON.stringify(value), JSON.stringify(entry));
          }
          assert.ok(currentRuns.every((entry: any) => oldRuns.some((old: any) => old.runId === entry.runId) || ownedRunIds.get(id)?.has(entry.runId)));
        } else assert.equal(JSON.stringify(current), JSON.stringify(old));
      }
      proof.originalConfigsStoresHistoricalProofsAndEveryOldEntryUnchanged = true;
    } catch (error) { cleanupError('Original host files and old journal entries preservation', error); }
    try {
      proof.finalSourceSha256 = {};
      for (const [file, expected] of Object.entries(freeze.sourceSha256)) {
        const actual = hash(await readFile(join(workspace, file))); proof.finalSourceSha256[file] = actual; assert.equal(actual, expected, file);
      }
      assert.equal(hash(await readFile(scriptFile)), proof.scriptSha256); assert.equal(hash(await readFile(freezeFile)), hash(freezeBytes));
      assert.deepEqual((await projectIdentitySources()).manifest, packaged.manifest);
      const manifest = await readFile(join(workspace, freeze.asset.directory, 'manifest.json'));
      assert.equal(hash(manifest), freeze.asset.manifestSha256); assert.equal(hash(await readFile(join(workspace, freeze.asset.directory, 'broker.py'))), setup.brokerManifest.sha256);
      proof.sourceScriptAndAssetsUnchanged = true;
    } catch (error) { cleanupError('Source/script/assets/freeze preservation', error); }
    proof.rootCommandObservations = commandReceipts; proof.originalFrameObservations = transportReceipts;
    proof.agentAudit = { events: ownAgent.audit, allOwnedPhysicalStreamsClosed: [...contextOwners.values()].every(value => value.streamCount === 0),
      privateKeyPersisted: false };
    if (!proof.vmStopped || proof.liveEntries || proof.exactQemuMatches || !proof.ownedQemuSettled) cleanupError('Exact VM shutdown', 'stopped/live/QEMU guard');
    if (!proof.agentAudit.allOwnedPhysicalStreamsClosed) cleanupError('Own physical streams', 'Not every task stream close was confirmed');
    proof.passed = !proof.error && !proof.cleanupErrors.length && proof.cases.length === proof.expectedCases;
    proof.phase = proof.passed ? 'finished' : 'failed'; await persist(); await line('SSH Agent identity proof: ' + proofFile);
    await log.sync(); await log.close(); process.exitCode = proof.passed ? 0 : 1;
  }
  if (!proof.passed) throw new Error('Owned Agent smoke failed; original wx evidence retained: ' + proofFile);
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--check-fixture') await checkFixture();
else {
  assert.ok(args.length === 4, 'Use node --import tsx scripts/smoke-ssh-agent-project-identity.ts <alpine|debian|ubuntu> <exact-fixture> <ssh-agent-project-identity-freeze-UUID.json> <--validate-only|--reuse-existing>.');
  const setup = await validate(args);
  if (args[3] === '--validate-only') console.log(JSON.stringify({ validated: true, vmStarted: false, fixture: setup.root,
    vmId: setup.vmId, distro: setup.distro, freezeSha256: hash(setup.freezeBytes), oldFarmProofSha256: fixtures[setup.distro].proofSha256,
    historicalFiles: setup.historicalFiles.length, unchangedProjects: [fixtures[setup.distro].alpha, fixtures[setup.distro].beta],
    brokerSha256: setup.brokerManifest.sha256, requiredSources: requiredSources.length, plannedCases: caseNames.length }, null, 2));
  else await runSmoke(setup);
}
