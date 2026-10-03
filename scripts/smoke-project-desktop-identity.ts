import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import ssh2, { type Client, type ClientChannel } from 'ssh2';
import { WebSocket, WebSocketServer } from 'ws';
import type { X11ClipboardSession } from '../shared/x11-clipboard.ts';
import type { AppReceipt } from '../server/single-app-sandbox.ts';
import { defaultClipboardRule, type ClipboardRule } from '../shared/clipboard-policy.ts';
import { LinuxDesktopOwnedFixture, captureDesktopSources, closeOwnedDesktopSshClient, desktopFixtureParent, desktopFixtureSource, sha256 } from './linux-desktop-owned-fixture.ts';
import { probeOwnedDesktopRfb } from './linux-desktop-rfb-probe.ts';

const singleAppFdClassifier = String.raw`
def classify_descriptor(row, objects, process_role):
 assert isinstance(row,dict) and type(row['number']) is int and row['number']>=0,'FD_NUMBER_INVALID'
 assert isinstance(row['target'],str) and 0<len(row['target'])<=4096,'FD_TARGET_INVALID'
 for key in ('device','inode','mountId','infoInode'):
  assert isinstance(row[key],str) and re.fullmatch(r'0|[1-9][0-9]*',row[key]),'FD_IDENTITY_INVALID'
 assert row['inode']==row['infoInode'],'FD_INFO_INODE_CHANGED'
 assert isinstance(row['flags'],str) and re.fullmatch(r'[0-7]+',row['flags']),'FD_FLAGS_INVALID'
 assert 0<=int(row['flags'],8)<2**64,'FD_FLAGS_INVALID'
 assert type(row['type']) is int,'FD_TYPE_INVALID'
 assert process_role in ('supervisor','vnc','wm','application','owned-descendant'),'FD_ROLE_INVALID'
 same_tuple=[];original=[];forbidden=[]
 for obj in objects:
  assert obj['kind'] in ('namespace','file','directory','supervisor-input'),'FD_OBJECT_KIND_INVALID'
  for key in ('device','inode','mountId'):
   assert isinstance(obj[key],str) and re.fullmatch(r'0|[1-9][0-9]*',obj[key]),'FD_OBJECT_IDENTITY_INVALID'
  if (row['device'],row['inode'],row['type'])!=(obj['device'],obj['inode'],obj['type']):continue
  same_tuple.append(obj['role'])
  if obj['kind']=='namespace':assert row['target']==obj['target'],'FD_NAMESPACE_TARGET_CHANGED'
  if row['mountId']!=obj['mountId']:continue
  original.append(obj['role'])
  if not (obj['kind']=='supervisor-input' and process_role=='supervisor' and row['number']==0):
   forbidden.append(obj['role'])
 return {'sameObjectTuple':same_tuple,'sameOriginalMount':original,'forbiddenOriginalManagementObjects':forbidden,
         'closeOnExec':bool(int(row['flags'],8)&os.O_CLOEXEC),'unattributedPipe':row['target'].startswith('pipe:[') and not original}
`;

if (process.argv.length === 2 || process.argv[2] === '--describe') {
  console.log('Windows owned Debian KDE COW only: --run-cow x11|wayland. The registered project-desktop and single-app-windows tests describe this fixture by default. Uses real directory migration, current project UID, full Desktop/native authority, public clipboard and SingleApp APIs. SingleApp checks independent UID, unchanged 0700/0600 project, real authenticated RFB pixels, live-listener port isolation, readonly reload, manual full-run stop and automatic full-domain retirement after natural xterm exit. Wayland additionally checks the production directory view and private 0700 application ELF. Historical source disk stays read locked. Keeps failures, logs and physical closes. Not fresh-image provisioning.');
} else {
  assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--run-cow');
  assert.ok(process.argv[3] === 'x11' || process.argv[3] === 'wayland');
  assert.deepEqual(process.execArgv, ['--import', 'tsx']);
  assert.equal(process.env.NODE_OPTIONS || '', '');
  await run(process.argv[3]);
}

async function run(transport: 'x11' | 'wayland') {
  const workspace = resolve('.'), fixture = new LinuxDesktopOwnedFixture(workspace);
  const proof: any = { version: 1, kind: 'owned-current-project-uid-desktop-' + transport, transport, invocation: fixture.invocation,
    root: fixture.root, vmId: fixture.vmId, sourceVmId: desktopFixtureSource.vmId,
    startedAt: new Date().toISOString(), passed: false, cases: [], phases: [], processes: fixture.processes,
    sshClients: [], sshChannels: [], webSockets: [], webSocketServers: [], commands: [], cleanupErrors: [], sourceBefore: {}, sourceAfter: {},
    provisioning: 'COW of already installed Debian KDE; new VM, SSH key, host catalog, projects and authority. No old binding/run adoption.',
    engine: 'test-only direct TCG; skips accelerator startup probe; production Machines/task/migration/Desktop/clipboard unchanged',
    client: { node: process.version, execArgv: process.execArgv, nodeOptions: process.env.NODE_OPTIONS || '' } };
  let machines: import('../server/machines.ts').Machines | undefined;
  let spaces: import('../server/workspaces.ts').Workspaces | undefined;
  let desktops: import('../server/desktop.ts').Desktops | undefined;
  let oldKey: Buffer | undefined;
  const clientClosures = new Map<Client, Promise<void>>(), clients = new Set<Client>();
  const clientStates = new Map<Client, { row: any; complete: () => void }>();
  const channelClosures = new Map<ClientChannel, Promise<void>>();
  const channelStates = new Map<ClientChannel, any>();
  let alpha: any, beta: any;
  const activeApps = new Set<string>();
  const activeSingleApps = new Set<string>();
  const reloadedAppOwners = new Set<import('../server/single-app-windows.ts').SingleAppWindows>();
  const webSockets = new Map<WebSocket, Promise<void>>();
  const webSocketServers = new Set<WebSocketServer>();
  const phase = (name: string) => { proof.phases.push({ name, at: new Date().toISOString() }); console.log('PHASE ' + name); };
  const checked = (name: string, details?: unknown) => { proof.cases.push({ name, passed: true, details }); console.log('PASS ' + name); };
  const errorValue = (error: unknown) => ({ message: error instanceof Error ? error.message : String(error), code: error instanceof Error ? Reflect.get(error, 'code') || null : null });

  function watchClient(client: Client, role: string, live?: object) {
    if (clientClosures.has(client)) return;
    clients.add(client);
    const row: any = { connectionId: randomUUID(), role, vmId: fixture.vmId, liveStartedAt: live && Reflect.get(live, 'startedAt'), ready: false, closed: false, errors: [] };
    proof.sshClients.push(row);
    client.on('error', (error) => row.errors.push(errorValue(error)));
    client.once('ready', () => { row.ready = true; row.readyAt = new Date().toISOString(); });
    clientClosures.set(client, new Promise<void>((done) => {
      clientStates.set(client, { row, complete: done });
      client.once('close', () => { row.closed = true; row.closedAt = new Date().toISOString(); clients.delete(client); done(); });
    }));
    const original = client.exec;
    Reflect.set(client, 'exec', (...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback === 'function') {
        const channel: any = { id: randomUUID(), connectionId: row.connectionId, commandSha256: sha256(String(args[0])), vmId: fixture.vmId, exit: null, closed: false, stderr: '', startedAt: new Date().toISOString() };
        proof.sshChannels.push(channel);
        args[args.length - 1] = (error: Error | undefined, stream: ClientChannel) => {
          if (error) { channel.setupError = errorValue(error); channel.notCreated = true; }
          if (stream) {
            stream.stderr.on('data', (bytes: Buffer) => { channel.stderr = (channel.stderr + bytes.toString()).slice(-8192); });
            stream.once('exit', (code: number | null, signal?: string) => { channel.exit = { code, signal: signal || null }; });
            channelStates.set(stream, channel);
            channelClosures.set(stream, new Promise<void>((done) => stream.once('close', () => {
              channel.closed = true; channel.closedAt = new Date().toISOString(); channel.stdoutClosed = stream.closed; channel.stderrClosed = stream.stderr.closed; done();
            })));
          }
          callback(error, stream);
        };
      }
      return Reflect.apply(original, client, args);
    });
  }

  async function closeClient(client: Client) {
    const state = clientStates.get(client)!;
    const result = await closeOwnedDesktopSshClient(client, state.row, clientClosures.get(client)!);
    if (result === 'not-created') { clients.delete(client); state.complete(); }
  }
  async function boundedTransport<T>(pending: Promise<T>, role: string, milliseconds = 10000) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(role + ' timed out')), milliseconds); })]); }
    finally { if (timer) clearTimeout(timer); }
  }

  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  async function guest(command: string, timeout = 30000) {
    assert.ok(machines);
    const result = await machines.exec(fixture.vmId, command, timeout);
    proof.commands.push({ commandSha256: sha256(command), timeout, ...result });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  }
  const python = async (source: string) => JSON.parse(await guest('/usr/bin/python3 -I -S -c ' + quote(source)));
  async function binding() {
    const { projectDesktopBindingSchema } = await import('../server/desktop-binding.ts');
    return projectDesktopBindingSchema.parse(JSON.parse(await readFile(join(fixture.root, 'machines', fixture.vmId, 'desktop-binding.json'), 'utf8')));
  }
  async function ready() {
    const until = Date.now() + 1000000;
    while (Date.now() < until) {
      const state = await desktops!.view(fixture.vmId, true);
      if (state.status === 'ready') return state;
      assert.notEqual(state.status, 'error', JSON.stringify(state));
      await delay(500);
    }
    throw new Error('Current UID Desktop readiness timeout');
  }
  const clipboard = () => transport === 'x11' ? desktops!.clipboard : desktops!.waylandClipboard;
  async function appAction(request: unknown) { return clipboard().action(fixture.vmId, request); }
  async function save(image: string, rule: ClipboardRule = defaultClipboardRule()) {
    const identity = await appAction({ action: 'identify', image }) as { image: string; sha256: string };
    const state = await clipboard().view(fixture.vmId);
    const value = await appAction({ action: 'save', version: state.version, application: { ...identity, rule } }) as { error?: string };
    assert.ok(!value.error, value.error);
  }
  async function launch(image: string, args: string[]) {
    const state = await clipboard().view(fixture.vmId);
    const session = await appAction({ action: 'launch', version: state.version, image, args }) as X11ClipboardSession;
    activeApps.add(session.id);
    assert.equal(session.state, 'running', session.error); assert.equal(session.active, true);
    assert.equal(session.desktopOwner!.uid, alpha.identity.uid); assert.equal(session.desktopOwner!.projectId, alpha.id);
    if (transport === 'x11') assert.deepEqual(session.applicationOwner, { uid: alpha.identity.uid, kind: 'project-desktop' });
    else {
      assert.equal(session.applicationOwner!.kind, 'window-sandbox'); assert.notEqual(session.applicationOwner!.uid, alpha.identity.uid);
      assert.ok(session.applicationOwner!.uid >= 1000 && session.applicationOwner!.uid < 20000);
    }
    return session;
  }
  async function stopApp(id: string) { await appAction({ action: 'stop', id }); activeApps.delete(id); }
  function watchWebSocket(socket: WebSocket, role: string) {
    const row: any = { id: randomUUID(), role, closed: false, errors: [], startedAt: new Date().toISOString() };
    proof.webSockets.push(row);
    socket.on('error', (error) => row.errors.push(errorValue(error)));
    webSockets.set(socket, new Promise<void>((done) => socket.once('close', (code) => {
      row.closed = true; row.code = code; row.closedAt = new Date().toISOString(); done();
    })));
  }
  async function marker(path: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const found = await machines!.exec(fixture.vmId, `test -f ${quote(path)} && cat ${quote(path)}`, 10000);
      if (found.code === 0) return found.stdout.trim();
      await delay(100);
    }
    throw new Error('Current UID controlled application marker missing: ' + path);
  }
  async function observeDesktop() {
    const value = await binding();
    const result = await python(`import os,json,stat,pwd
binding=json.loads(${JSON.stringify(JSON.stringify(value))});identity=binding['execution']['identity'];runtime=binding['execution']['runtime'];scope='0::/'+binding['execution']['run']['cgroupName']+'\\n'
def file(path):
 s=os.lstat(path);return {'path':path,'dev':str(s.st_dev),'ino':str(s.st_ino),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'type':stat.S_IFMT(s.st_mode)}
def process(pid):
 status=dict(line.split(':',1) for line in open('/proc/'+str(pid)+'/status'));env=dict(item.split('=',1) for item in open('/proc/'+str(pid)+'/environ','rb').read().decode().split('\\0') if '=' in item)
 return {'pid':pid,'status':{k:status[k].strip() for k in ('Uid','Gid','Groups','NoNewPrivs','CapInh','CapPrm','CapEff','CapBnd','CapAmb')},'cgroup':open('/proc/'+str(pid)+'/cgroup').read(),'cwd':os.readlink('/proc/'+str(pid)+'/cwd'),'environment':{k:env.get(k) for k in ('HOME','USER','LOGNAME','DISPLAY','XAUTHORITY','XDG_RUNTIME_DIR','SAKURA_CURRENT_UID_PROBE')},'networkInode':str(os.stat('/proc/'+str(pid)+'/ns/net').st_ino)}
print(json.dumps({'identity':identity,'account':pwd.getpwuid(identity['uid']).pw_name,'home':file(identity['home']),'directory':file(identity['directory']),'runtime':file(runtime),'plasma':process(binding['execution']['endpoint']['plasmaPid']),'vnc':process(binding['execution']['endpoint']['vncPid']),'scope':scope}))`);
    assert.equal(value.version, 2); assert.equal(value.state, 'running'); assert.deepEqual(value.execution.identity, alpha.identity);
    assert.equal(result.account, alpha.identity.account); assert.equal(result.home.uid, alpha.identity.uid);
    assert.equal(result.home.mode, 0o700); assert.equal(result.directory.uid, alpha.identity.uid); assert.equal(result.directory.mode, 0o700);
    assert.equal(result.directory.dev, alpha.identity.directoryDevice); assert.equal(result.directory.ino, alpha.identity.directoryInode);
    assert.equal(result.runtime.uid, alpha.identity.uid); assert.equal(result.runtime.mode, 0o700);
    for (const process of [result.plasma, result.vnc]) {
      assert.equal(process.cgroup, result.scope);
      assert.deepEqual(process.status.Uid.split(/\s+/).map(Number), Array(4).fill(alpha.identity.uid));
      assert.deepEqual(process.status.Gid.split(/\s+/).map(Number), Array(4).fill(alpha.identity.gid));
      assert.equal(process.status.NoNewPrivs, '1');
      for (const capability of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.equal(BigInt('0x' + process.status[capability]), 0n);
    }
    assert.equal(result.plasma.environment.HOME, alpha.identity.home); assert.equal(result.plasma.environment.USER, alpha.identity.account);
    assert.equal(result.plasma.environment.SAKURA_CURRENT_UID_PROBE, fixture.invocation);
    proof.desktopObservations ||= []; proof.desktopObservations.push({ binding: value, result }); return value;
  }

  async function desktopListenerBaseline(receipt: AppReceipt) {
    const desktop = await binding(); assert.equal(desktop.state, 'running');
    assert.deepEqual(desktop.execution.identity, receipt.identity);
    assert.equal(desktop.execution.run!.networkDevice, receipt.run.networkDevice);
    assert.equal(desktop.execution.run!.networkInode, receipt.run.networkInode);
    const { desktopProjectCommand } = await import('../server/desktop-project-control.ts');
    const command = desktopProjectCommand('stream', { version: 1, ...desktop.execution });
    const live = machines!.live.get(fixture.vmId), client = await machines!.connect(fixture.vmId);
    watchClient(client, 'fixed-readonly-desktop-listener-baseline', live);
    let channel: ClientChannel | undefined;
    let banner: Buffer | undefined;
    try {
      channel = await boundedTransport(new Promise<ClientChannel>((done, reject) => client.exec(command, (error, stream) => {
        if (error) reject(error); else done(stream);
      })), 'Fixed Desktop baseline channel setup');
      const stream = channel;
      banner = await boundedTransport(new Promise<Buffer>((done, reject) => {
        let bytes = Buffer.alloc(0);
        stream.on('error', reject);
        stream.on('data', (part: Buffer) => {
          bytes = Buffer.concat([bytes, part]);
          if (bytes.length > 65536) reject(new Error('Fixed Desktop baseline exceeded banner budget'));
          else if (bytes.length >= 12) done(bytes.subarray(0, 12));
        });
        stream.once('close', () => { if (bytes.length < 12) reject(new Error('Fixed Desktop baseline closed before its real RFB banner')); });
      }), 'Fixed Desktop real listener banner');
      assert.equal(banner.toString(), 'RFB 003.008\n');
      stream.end(); await boundedTransport(channelClosures.get(stream)!, 'Fixed Desktop baseline channel physical close');
      assert.deepEqual(channelStates.get(stream).exit, { code: 0, signal: null });
    } finally {
      if (channel && !channelStates.get(channel)?.closed) channel.destroy();
      await closeClient(client);
    }
    assert.equal(machines!.live.get(fixture.vmId), live);
    const result = { port: 5901, banner: banner!.toString(), networkDevice: receipt.run.networkDevice, networkInode: receipt.run.networkInode,
      desktopRunId: desktop.execution.run!.runId, desktopEndpoint: desktop.execution.endpoint,
      commandSha256: sha256(command), sshConnectionId: clientStates.get(client)!.row.connectionId,
      channelId: channelStates.get(channel!).id, channelPhysicallyClosed: channelStates.get(channel!).closed,
      sshPhysicallyClosed: clientStates.get(client)!.row.closed };
    proof.desktopBridgeBaselines ||= []; proof.desktopBridgeBaselines.push(result); return result;
  }

  async function projectSignal(path: string, value: unknown) {
    assert.ok(path.startsWith(alpha.directory + '/'));
    const leaf = path.slice(alpha.directory.length + 1); assert.match(leaf, /^[a-z0-9.-]+$/); assert.ok(leaf !== '.' && leaf !== '..');
    const { projectIdentityTask } = await import('../server/project-run-scope.ts');
    const raw = JSON.stringify(value);
    const result = await projectIdentityTask(machines!, fixture.vmId, await spaces!.resolvedConfig(fixture.vmId), {
      command: `set -eu\numask 077\ntest ! -e ${quote(leaf)} && test ! -L ${quote(leaf)}\ntest ! -e ${quote(leaf + '.new')} && test ! -L ${quote(leaf + '.new')}\n(set -C; printf %s ${quote(Buffer.from(raw).toString('base64'))} | base64 -d > ${quote(leaf + '.new')})\nmv -T -- ${quote(leaf + '.new')} ${quote(leaf)}\n`,
    }, new AbortController().signal, undefined, 30000);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    proof.projectSignalTasks ||= []; proof.projectSignalTasks.push({ path, inputSha256: sha256(raw), result });
  }

  async function windowPortChecks(receipt: AppReceipt, path: string) {
    const before = await desktopListenerBaseline(receipt);
    await projectSignal(path + '.ports.start', { version: 1, kind: 'owned-single-app-port-check', marker: path,
      ownPort: receipt.port, blockedPort: 5901, uid: receipt.uid, gid: receipt.gid,
      networkDevice: receipt.run.networkDevice, networkInode: receipt.run.networkInode });
    const observed = JSON.parse(await marker(path + '.ports.result'));
    assert.equal(observed.passed, true, JSON.stringify(observed)); assert.equal(observed.ownPort, receipt.port);
    assert.equal(observed.ownListenerBanner, 'RFB 003.008\n'); assert.equal(observed.blockedPort, 5901);
    assert.equal(observed.uid, receipt.uid); assert.equal(observed.gid, receipt.gid);
    assert.equal(observed.networkDevice, receipt.run.networkDevice); assert.equal(observed.networkInode, receipt.run.networkInode);
    const after = await desktopListenerBaseline(receipt);
    assert.equal(after.desktopRunId, before.desktopRunId); assert.deepEqual(after.desktopEndpoint, before.desktopEndpoint);
    return { before, application: observed, after };
  }

  async function singleAppProcesses(receipt: AppReceipt) {
    const allProcesses = await python(`import os,json
group='/sys/fs/cgroup/'+${JSON.stringify(receipt.run.cgroupName)}
def inspect(pid):
 p='/proc/'+str(pid);s=dict(line.split(':',1) for line in open(p+'/status'));image=os.stat(p+'/exe')
 return {'pid':pid,'created':open(p+'/stat').read().rsplit(')',1)[1].split()[19],'image':os.readlink(p+'/exe'),'imageDevice':str(image.st_dev),'imageInode':str(image.st_ino),'cgroup':open(p+'/cgroup').read(),'uids':list(map(int,s['Uid'].split())),'gids':list(map(int,s['Gid'].split())),'groups':s['Groups'].split(),'nnp':s['NoNewPrivs'].strip(),'caps':{key:s[key].strip() for key in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb')},'networkDevice':str(os.stat(p+'/ns/net').st_dev),'networkInode':str(os.stat(p+'/ns/net').st_ino),'mountDevice':str(os.stat(p+'/ns/mnt').st_dev),'mountInode':str(os.stat(p+'/ns/mnt').st_ino)}
print(json.dumps([inspect(int(pid)) for pid in open(group+'/cgroup.procs').read().split()]))`);
    assert.ok(allProcesses.length >= 5);
    for (const item of allProcesses) {
      assert.deepEqual(item.uids, Array(4).fill(receipt.uid)); assert.deepEqual(item.gids, Array(4).fill(receipt.gid)); assert.deepEqual(item.groups, []);
      assert.equal(item.nnp, '1'); for (const capability of ['CapInh', 'CapPrm', 'CapEff', 'CapAmb']) assert.equal(BigInt('0x' + item.caps[capability]), 0n);
      assert.equal(item.cgroup, '0::/' + receipt.run.cgroupName + '\n'); assert.equal(item.networkDevice, receipt.run.networkDevice); assert.equal(item.networkInode, receipt.run.networkInode);
      assert.equal(item.mountDevice, receipt.directoryView!.device); assert.equal(item.mountInode, receipt.directoryView!.inode);
    }
    for (const pinned of [receipt.supervisor!, receipt.endpoint!, receipt.processes!.application, receipt.processes!.wm]) {
      const actual = allProcesses.find((item: any) => item.pid === pinned.pid);
      assert.ok(actual, 'Original SingleApp process is not in its exact full run');
      assert.equal(actual.created, pinned.created); assert.equal(actual.image, pinned.image);
      assert.equal(actual.imageDevice, pinned.device); assert.equal(actual.imageInode, pinned.inode);
    }
    assert.ok(allProcesses.some((item: any) => item.image === receipt.image.path && item.imageDevice === receipt.image.device && item.imageInode === receipt.image.inode));
    assert.ok(allProcesses.some((item: any) => item.image === receipt.tools.wm.path && item.imageDevice === receipt.tools.wm.device && item.imageInode === receipt.tools.wm.inode));
    return allProcesses;
  }

  async function singleAppFdObservation(receipt: AppReceipt, processes: any[], role: 'manual-stop' | 'natural-exit') {
    const live = machines!.live.get(fixture.vmId); assert.ok(live);
    const controller = '/usr/local/lib/sakura-single-app/' + receipt.build;
    const expectedSources = Object.fromEntries(['controller.py', 'directory-view.py', 'sources.json'].map(name => {
      const digest = proof.sourceBefore['native/single-app/' + name]; assert.match(digest, /^[a-f0-9]{64}$/);
      return [controller + '/' + name, digest];
    }));
    const source = `import os,json,stat,re,select,time,hashlib
from pathlib import Path
receipt=json.loads(${JSON.stringify(JSON.stringify(receipt))})
expected_processes=json.loads(${JSON.stringify(JSON.stringify(processes))})
expected_sources=json.loads(${JSON.stringify(JSON.stringify(expectedSources))})
${singleAppFdClassifier}
deadline=time.monotonic()+15
result={'passed':False,'observationBudgetMilliseconds':15000,'retried':False,'processes':[],'originalObjects':[]}
held=[];pinned=[]
def budget():assert time.monotonic()<deadline,'FD_OBSERVATION_BUDGET_EXCEEDED'
def keep(fd):held.append(fd);return fd
def fingerprint(info):return (info.st_dev,info.st_ino,info.st_mode,info.st_uid,info.st_gid,info.st_nlink,info.st_size,info.st_mtime_ns,info.st_ctime_ns)
def read_at(parent,name,maximum):
 budget();fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC|os.O_NONBLOCK,dir_fd=parent)
 try:
  raw=os.read(fd,maximum+1);assert len(raw)<=maximum,'FD_READ_BUDGET_EXCEEDED';return raw
 finally:os.close(fd)
def fd_info(parent,name):
 raw=read_at(parent,name,16384).decode('ascii');value={}
 for line in raw.splitlines():
  key,separator,item=line.partition(':');assert separator,'FD_INFO_INVALID'
  if key in ('flags','mnt_id','ino'):
   assert key not in value,'FD_INFO_INVALID';value[key]=item.strip()
 assert set(value)=={'flags','mnt_id','ino'},'FD_INFO_INVALID'
 return {'flags':value['flags'],'mountId':value['mnt_id'],'infoInode':value['ino']}
def descriptor(fd_directory,info_directory,number):
 name=str(number);before=os.stat(name,dir_fd=fd_directory);target=os.readlink(name,dir_fd=fd_directory)
 details=fd_info(info_directory,name);after=os.stat(name,dir_fd=fd_directory)
 assert (before.st_dev,before.st_ino,before.st_mode,before.st_uid,before.st_gid)==(after.st_dev,after.st_ino,after.st_mode,after.st_uid,after.st_gid),'FD_ENTRY_CHANGED'
 assert target==os.readlink(name,dir_fd=fd_directory) and details==fd_info(info_directory,name),'FD_ENTRY_CHANGED'
 return {'number':number,'target':target,'device':str(before.st_dev),'inode':str(before.st_ino),'type':stat.S_IFMT(before.st_mode),
         'uid':before.st_uid,'gid':before.st_gid,'mode':stat.S_IMODE(before.st_mode),**details}
def process(fd):
 raw=read_at(fd,'stat',8192).decode();fields=raw.rsplit(')',1)[1].split()
 status=dict(line.split(':',1) for line in read_at(fd,'status',16384).decode().splitlines())
 image=os.stat('exe',dir_fd=fd);network=os.stat('ns/net',dir_fd=fd);mount=os.stat('ns/mnt',dir_fd=fd)
 return {'pid':int(raw.split('(',1)[0]),'created':fields[19],'image':os.readlink('exe',dir_fd=fd),'imageDevice':str(image.st_dev),'imageInode':str(image.st_ino),
         'cgroup':read_at(fd,'cgroup',8192).decode(),'uids':list(map(int,status['Uid'].split())),'gids':list(map(int,status['Gid'].split())),
         'groups':status['Groups'].split(),'nnp':status['NoNewPrivs'].strip(),'caps':{key:status[key].strip() for key in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb')},
         'networkDevice':str(network.st_dev),'networkInode':str(network.st_ino),'mountDevice':str(mount.st_dev),'mountInode':str(mount.st_ino)}
def original_object(role,kind,path,expected=None,root_file=False):
 budget();flags=os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC|os.O_NONBLOCK
 if kind=='directory':flags|=os.O_DIRECTORY
 fd=keep(os.open(path,flags));info=os.fstat(fd)
 assert fingerprint(info)==fingerprint(os.lstat(path)),'FD_ORIGINAL_PATH_CHANGED'
 assert stat.S_ISDIR(info.st_mode) if kind=='directory' else stat.S_ISREG(info.st_mode),'FD_ORIGINAL_TYPE_CHANGED'
 if root_file:assert info.st_uid==info.st_gid==0 and not stat.S_IMODE(info.st_mode)&0o022,'FD_ROOT_SOURCE_PERMISSIONS_CHANGED'
 own_fd=os.open('/proc/self/fd',os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
 own_info=os.open('/proc/self/fdinfo',os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
 try:row=descriptor(own_fd,own_info,fd)
 finally:os.close(own_info);os.close(own_fd)
 obj={**row,'role':role,'kind':kind,'path':path,'fingerprint':fingerprint(info),'heldFd':fd}
 if expected is not None:
  raw=os.read(fd,262145);assert len(raw)<=262144,'FD_SOURCE_SIZE_EXCEEDED'
  obj['sha256']=hashlib.sha256(raw).hexdigest();assert obj['sha256']==expected,'FD_CONTROLLED_SOURCE_CHANGED'
  assert fingerprint(os.fstat(fd))==fingerprint(info),'FD_CONTROLLED_SOURCE_CHANGED'
 result['originalObjects'].append(obj);return obj
def namespace_object(role,proc,name,device,inode):
 budget();fd=keep(os.open('ns/'+name,os.O_RDONLY|os.O_CLOEXEC,dir_fd=proc));info=os.fstat(fd)
 assert (str(info.st_dev),str(info.st_ino))==(device,inode),'FD_ORIGINAL_NAMESPACE_CHANGED'
 own_fd=os.open('/proc/self/fd',os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
 own_info=os.open('/proc/self/fdinfo',os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
 try:row=descriptor(own_fd,own_info,fd)
 finally:os.close(own_info);os.close(own_fd)
 assert row['target']==name+':['+inode+']','FD_ORIGINAL_NAMESPACE_CHANGED'
 obj={**row,'role':role,'kind':'namespace','heldFd':fd,'fingerprint':fingerprint(info)};result['originalObjects'].append(obj);return obj
try:
 budget();boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip();assert boot==receipt['run']['bootId'],'FD_BOOT_CHANGED';result['bootId']=boot
 assert 5<=len(expected_processes)<=64 and len({item['pid'] for item in expected_processes})==len(expected_processes),'FD_PROCESS_INVENTORY_INVALID'
 for expected in expected_processes:
  budget();pidfd=keep(os.pidfd_open(expected['pid'],0));poller=select.poll();poller.register(pidfd,select.POLLIN)
  proc=keep(os.open('/proc/'+str(expected['pid']),os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC))
  assert not poller.poll(0),'FD_ORIGINAL_PROCESS_EXITED'
  before=process(proc);assert before==expected,'FD_ORIGINAL_PROCESS_CHANGED'
  assert before['uids']==[receipt['uid']]*4 and before['gids']==[receipt['gid']]*4 and before['groups']==[] and before['nnp']=='1','FD_PROCESS_AUTHORITY_CHANGED'
  assert all(int(before['caps'][key],16)==0 for key in ('CapInh','CapPrm','CapEff','CapAmb')),'FD_PROCESS_AUTHORITY_CHANGED'
  assert before['cgroup']=='0::/'+receipt['run']['cgroupName']+'\\n','FD_CGROUP_CHANGED'
  assert (before['networkDevice'],before['networkInode'])==(receipt['run']['networkDevice'],receipt['run']['networkInode']),'FD_NETWORK_CHANGED'
  assert (before['mountDevice'],before['mountInode'])==(receipt['directoryView']['device'],receipt['directoryView']['inode']),'FD_VIEW_CHANGED'
  fds=keep(os.open('fd',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=proc))
  infos=keep(os.open('fdinfo',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=proc))
  pinned.append({'expected':expected,'proc':proc,'fds':fds,'infos':infos,'poller':poller,'before':before})
 supervisor=next(item for item in pinned if item['expected']['pid']==receipt['supervisor']['pid'])
 namespace_object('original-network',supervisor['proc'],'net',receipt['run']['networkDevice'],receipt['run']['networkInode'])
 namespace_object('original-directory-view',supervisor['proc'],'mnt',receipt['directoryView']['device'],receipt['directoryView']['inode'])
 group=original_object('original-run-cgroup','directory','/sys/fs/cgroup/'+receipt['run']['cgroupName'])
 assert (group['device'],group['inode'])==(receipt['run']['cgroupDevice'],receipt['run']['cgroupInode']),'FD_CGROUP_CHANGED'
 source_directory=original_object('original-root-source-directory','directory',receipt['identity']['directory'])
 assert (source_directory['device'],source_directory['inode'])==(receipt['identity']['directoryDevice'],receipt['identity']['directoryInode']),'FD_PROJECT_DIRECTORY_CHANGED'
 assert (source_directory['uid'],source_directory['gid'],source_directory['mode'])==(receipt['identity']['uid'],receipt['identity']['gid'],receipt['directoryView']['directoryMode']),'FD_PROJECT_DIRECTORY_CHANGED'
 for path,digest in expected_sources.items():original_object('controlled-source:'+path.rsplit('/',1)[1],'file',path,digest,True)
 metadata_path='/var/lib/sakura/single-app-uid/'+receipt['id']+'/session.json'
 metadata=original_object('original-root-receipt','file',metadata_path,root_file=True)
 raw=os.read(metadata['heldFd'],65537);assert len(raw)<=65536 and json.loads(raw)==receipt,'FD_ORIGINAL_RECEIPT_CHANGED'
 original_object('original-single-app-lock','file','/var/lib/sakura/single-app-uid/controller.lock',root_file=True)
 original_object('original-project-registry-lock','file','/var/lib/sakura/project-identities/lock',root_file=True)
 private_input=descriptor(supervisor['fds'],supervisor['infos'],0)
 assert stat.S_ISFIFO(private_input['type']) and re.fullmatch(r'pipe:\[[0-9]+\]',private_input['target']),'FD_SUPERVISOR_INPUT_UNVERIFIED'
 result['originalObjects'].append({**private_input,'kind':'supervisor-input','role':'original-supervisor-stdin'})
 members=set(map(int,Path('/sys/fs/cgroup/'+receipt['run']['cgroupName']+'/cgroup.procs').read_text().split()))
 assert members=={item['pid'] for item in expected_processes},'FD_FULL_RUN_CHANGED'
 for item in pinned:
  budget();expected=item['expected'];pid=expected['pid'];process_role='owned-descendant'
  for role,original in [('supervisor',receipt['supervisor']),('vnc',receipt['endpoint']),('application',receipt['processes']['application']),('wm',receipt['processes']['wm'])]:
   if pid==original['pid']:
    process_role=role;assert (expected['created'],expected['image'],expected['imageDevice'],expected['imageInode'])==(original['created'],original['image'],original['device'],original['inode']),'FD_RECEIPT_PROCESS_CHANGED'
  names=sorted(os.listdir(item['fds']),key=int);assert len(names)<=1024 and all(re.fullmatch(r'0|[1-9][0-9]*',name) for name in names),'FD_ENUMERATION_INVALID'
  observed={'role':process_role,'pid':pid,'created':expected['created'],'before':item['before'],'descriptors':[],'stableEnumeration':False}
  result['processes'].append(observed)
  for name in names:
   budget();row=descriptor(item['fds'],item['infos'],int(name));row['classification']=classify_descriptor(row,result['originalObjects'],process_role)
   observed['descriptors'].append(row)
   assert not row['classification']['forbiddenOriginalManagementObjects'],'FD_ORIGINAL_MANAGEMENT_OBJECT_INHERITED'
  assert sorted(os.listdir(item['fds']),key=int)==names,'FD_ENUMERATION_CHANGED'
  observed['after']=process(item['proc']);assert observed['after']==item['before'] and not item['poller'].poll(0),'FD_ORIGINAL_PROCESS_CHANGED'
  observed['stableEnumeration']=True
 assert descriptor(supervisor['fds'],supervisor['infos'],0)==private_input,'FD_SUPERVISOR_INPUT_CHANGED'
 for obj in result['originalObjects']:
  if obj['kind']=='supervisor-input':continue
  assert fingerprint(os.fstat(obj['heldFd']))==obj['fingerprint'],'FD_ORIGINAL_OBJECT_CHANGED'
  if 'path' in obj:assert fingerprint(os.lstat(obj['path']))==obj['fingerprint'],'FD_ORIGINAL_PATH_CHANGED'
 assert Path('/proc/sys/kernel/random/boot_id').read_text().strip()==boot,'FD_BOOT_CHANGED'
 assert set(map(int,Path('/sys/fs/cgroup/'+receipt['run']['cgroupName']+'/cgroup.procs').read_text().split()))==members,'FD_FULL_RUN_CHANGED'
 for item,observed in zip(pinned,result['processes']):
  observed['final']=process(item['proc']);assert observed['final']==item['before'] and not item['poller'].poll(0),'FD_ORIGINAL_PROCESS_CHANGED'
 budget();result['passed']=True
except BaseException as error:
 result['error']={'type':type(error).__name__,'message':str(error)}
finally:
 for descriptor_to_close in reversed(held):os.close(descriptor_to_close)
 for obj in result['originalObjects']:obj.pop('heldFd',None)
print(json.dumps(result))`;
    const observed = await python(source);
    const record = { role, originalRun: receipt.run, sourceSha256: sha256(source), observation: observed, liveUnchanged: machines!.live.get(fixture.vmId) === live,
      productionReady: { managedStartReturnedRunning: receipt.state === 'running', originalReadyPipeInodeCaptured: false,
        exactReadyPipeCompared: false, evidence: 'Indirect production start EOF requirement; no original ready pipe inode receipt.' } };
    proof.singleAppFdObservations ||= []; proof.singleAppFdObservations.push(record);
    assert.equal(record.liveUnchanged, true);
    assert.equal(observed.passed, true, JSON.stringify(observed)); assert.equal(observed.bootId, receipt.run.bootId);
    return record;
  }

  async function singleAppPublicChecks(helper: string) {
    phase('public-single-app-current-project-private-directory');
    const source = await readFile(join(workspace, 'scripts/linux-desktop-single-app-probe.py'));
    assert.equal(sha256(source), proof.sourceBefore['scripts/linux-desktop-single-app-probe.py']);
    await guest(`set -eu; printf %s ${quote(source.toString('base64'))} | base64 -d > ${quote(helper + '/single-app-probe.py')}; chmod 644 ${quote(helper + '/single-app-probe.py')}`);
    const paths = [alpha.directory, alpha.directory + '/private.txt'];
    async function snapshot() {
      return python(`import os,json,stat,errno
def item(path):
 s=os.lstat(path)
 try:acl=os.getxattr(path,'system.posix_acl_access').hex()
 except OSError as e:
  assert e.errno in (errno.ENODATA,errno.ENOTSUP);acl=None
 return {'path':path,'device':str(s.st_dev),'inode':str(s.st_ino),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'acl':acl}
print(json.dumps([item(path) for path in ${JSON.stringify(paths)}]))`);
    }
    const before = await snapshot(), path = alpha.directory + '/single-app-' + fixture.invocation + '.json';
    assert.equal(before[0].mode, 0o700); assert.equal(before[1].mode, 0o600);
    assert.equal(before[0].uid, alpha.identity.uid); assert.equal(before[1].uid, alpha.identity.uid);
    const expected = await guest('cat ' + quote(alpha.directory + '/private.txt'));
    const session: any = await desktops!.apps.start(fixture.vmId, { program: 'xterm',
      args: ['-hold', '-e', '/usr/bin/python3', '-I', '-S', helper + '/single-app-probe.py', alpha.directory, path, expected, ' retained argument spaces 界 '],
      resolution: '1024x768', clipboard: { copy: false, paste: false } });
    activeSingleApps.add(session.id); assert.match(session.id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    const { appReceiptSchema } = await import('../server/single-app-sandbox.ts');
    const metadataPath = '/var/lib/sakura/single-app-uid/' + session.id + '/session.json';
    const nativeBytes = await guest('cat ' + quote(metadataPath)), receipt = appReceiptSchema.parse(JSON.parse(nativeBytes));
    assert.equal(receipt.state, 'running'); assert.deepEqual(receipt.identity, alpha.identity);
    assert.equal(receipt.run.mode, 'independent'); assert.equal(receipt.run.runId, session.id); assert.equal(receipt.run.bootId, proof.bootId);
    assert.ok(receipt.uid >= 1000 && receipt.uid < 20000); assert.notEqual(receipt.uid, alpha.identity.uid);
    assert.deepEqual(session.projectOwner, { uid: alpha.identity.uid, user: alpha.identity.account });
    assert.deepEqual(session.applicationOwner, { uid: receipt.uid, user: receipt.user });
    assert.equal(session.dataDirectory, receipt.home);
    const observed = JSON.parse(await marker(path)), detached = JSON.parse(await marker(path + '.detached'));
    assert.equal(observed.passed, true, JSON.stringify(observed)); assert.equal(detached.passed, true, JSON.stringify(detached));
    assert.equal(observed.argumentPreserved, ' retained argument spaces 界 '); assert.equal(observed.absoluteAndRelativeReadWrite, true);
    for (const item of [observed, detached]) {
      assert.equal(item.uid, receipt.uid); assert.equal(item.gid, receipt.gid); assert.equal(item.home, receipt.home); assert.equal(item.user, receipt.user);
      assert.equal(item.homeDevice, receipt.homeDevice); assert.equal(item.homeInode, receipt.homeInode);
      assert.equal(item.cgroup, '0::/' + receipt.run.cgroupName + '\n');
      assert.equal(item.networkDevice, receipt.run.networkDevice); assert.equal(item.networkInode, receipt.run.networkInode);
      assert.equal(item.mountDevice, receipt.directoryView!.device); assert.equal(item.mountInode, receipt.directoryView!.inode);
    }
    assert.equal(detached.pid, observed.detachedPid); assert.equal(detached.sid, detached.pid); assert.notEqual(observed.sid, detached.sid);
    const allProcesses = await singleAppProcesses(receipt);
    for (const item of [observed, detached]) assert.equal(allProcesses.find((row: any) => row.pid === item.pid)?.created, item.created);
    const descriptorObservation = await singleAppFdObservation(receipt, allProcesses, 'manual-stop');
    assert.deepEqual(await snapshot(), before);
    const created = await python(`import os,json,stat
print(json.dumps([{'path':path,'uid':os.lstat(path).st_uid,'gid':os.lstat(path).st_gid,'mode':stat.S_IMODE(os.lstat(path).st_mode),'text':open(path).read()} for path in ${JSON.stringify([alpha.directory + '/single-app-relative.txt', alpha.directory + '/single-app-absolute.txt'])}]))`);
    for (const item of created) { assert.equal(item.uid, alpha.identity.uid); assert.equal(item.gid, alpha.identity.gid); assert.equal(item.mode, 0o600); }
    const { password: _password, ...publicSession } = session;
    const { password: _receiptPassword, ...publicReceipt } = receipt;
    proof.singleApp = { session: publicSession, receipt: publicReceipt, observed, detached, allProcesses, created, descriptorObservation, originalOwnerModeAclBefore: before };
    checked('public-single-app-independent-uid-home-full-run-mount-network-and-detached-descendant-private-directory', proof.singleApp);
    proof.singleApp.ports = await windowPortChecks(receipt, path);
    checked('single-app-uid-reaches-own-vnc-and-refuses-live-desktop-port-in-exact-same-network', proof.singleApp.ports);
    const journalPath = join(fixture.root, 'machines', fixture.vmId, 'single-app-runs.json');
    const journalBefore = await readFile(journalPath), nativeBefore = await guest('cat ' + quote(metadataPath));
    const { SingleAppWindows, singleAppRunRecordSchema } = await import('../server/single-app-windows.ts');
    const reloaded = new SingleAppWindows(machines!, spaces!); reloadedAppOwners.add(reloaded);
    const restored = (await reloaded.list(fixture.vmId)).find((item) => item.id === session.id)!;
    assert.equal(restored.status, 'running'); assert.equal(restored.dataDirectory, receipt.home);
    assert.equal(await reloaded.port(fixture.vmId, session.id), session.port);
    const streamCommand = await reloaded.connectionCommand(fixture.vmId, session.id, session.port);
    assert.ok(streamCommand.includes('/usr/local/lib/sakura-single-app/' + receipt.build + '/controller.py'));
    assert.ok(streamCommand.includes(' stream ' + session.id + ' ')); assert.ok(!streamCommand.includes(session.password));
    assert.equal(sha256(await readFile(journalPath)), sha256(journalBefore)); assert.equal(await guest('cat ' + quote(metadataPath)), nativeBefore);
    proof.singleApp.readonlyRecovery = { status: restored.status, commandSha256: sha256(streamCommand), hostJournalSha256: sha256(journalBefore), nativeReceiptSha256: sha256(nativeBefore) };
    checked('host-reload-single-app-readonly-exact-journal-native-origin-and-stream-recovery', proof.singleApp.readonlyRecovery);
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); webSocketServers.add(server);
    const serverRow: any = { id: randomUUID(), role: 'single-app-fixed-owned-loopback-rfb', closed: false, errors: [] };
    proof.webSocketServers.push(serverRow);
    server.on('error', (error) => serverRow.errors.push(errorValue(error)));
    const serverClosed = new Promise<void>((done) => server.once('close', () => { serverRow.closed = true; serverRow.closedAt = new Date().toISOString(); webSocketServers.delete(server); done(); }));
    server.on('connection', (socket, request) => {
      watchWebSocket(socket, 'owned-single-app-rfb-server');
      if (request.url !== '/' + serverRow.id) { socket.terminate(); return; }
      void desktops!.attach(fixture.vmId, socket, false, session.port, session.id).catch((error) => {
        serverRow.errors.push(errorValue(error)); socket.terminate();
      });
    });
    await boundedTransport(new Promise<void>((done, reject) => { server.once('listening', done); server.once('error', reject); }), 'Owned RFB server listen');
    const address = server.address(); assert.ok(address && typeof address !== 'string'); serverRow.address = address;
    try {
      const url = 'ws://127.0.0.1:' + address.port + '/' + serverRow.id;
      const invalidPassword = (session.password[0] === 'A' ? 'B' : 'A') + session.password.slice(1);
      proof.singleApp.rfbRejected = await probeOwnedDesktopRfb(url, invalidPassword, false, (socket) => watchWebSocket(socket, 'single-app-rfb-wrong-password'));
      proof.singleApp.rfbAccepted = await probeOwnedDesktopRfb(url, session.password, true, (socket) => watchWebSocket(socket, 'single-app-rfb-current-password'));
      assert.equal(serverRow.errors.length, 0);
      checked('public-single-app-real-rfb-only-vnc-auth-reject-wrong-password-and-authenticated-binary-pixels', { refused: proof.singleApp.rfbRejected, accepted: proof.singleApp.rfbAccepted });
    } finally {
      for (const socket of server.clients) socket.terminate();
      await boundedTransport(new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())), 'Owned RFB server close callback');
      await boundedTransport(serverClosed, 'Owned RFB server physical close');
    }
    const stopped = await reloaded.stop(fixture.vmId, session.id);
    assert.equal(stopped.stopped, true);
    // Reload retires the same native run. The original in-process owner must
    // also release its captured preparation lease using that exact run.
    const originalOwnerStopped = await desktops!.apps.stop(fixture.vmId, session.id);
    assert.equal(originalOwnerStopped.stopped, true); activeSingleApps.delete(session.id);
    const afterStop = (await desktops!.apps.list(fixture.vmId)).find(item => item.id === session.id)!;
    assert.equal(afterStop.status, 'stopped');
    const journalAfterBytes = await readFile(journalPath), journalAfter = JSON.parse(journalAfterBytes.toString());
    assert.equal(journalAfter.sessions.length, 1);
    assert.equal(journalAfter.sessions[0].id, session.id); assert.deepEqual(journalAfter.sessions[0].run, receipt.run);
    assert.equal(journalAfter.sessions[0].phase, 'stopped');
    const retiredRecord = singleAppRunRecordSchema.parse(journalAfter.sessions[0]);
    assert.equal(retiredRecord.closure!.phase, 'closed'); assert.deepEqual({ ...retiredRecord.closure, phase: receipt.run.phase }, receipt.run);
    proof.singleApp.originalOwnerRetirement = { originalRunId: session.id, readonlyOwnerStopped: stopped.stopped,
      originalOwnerStopped: originalOwnerStopped.stopped, state: afterStop.status, hostJournalSha256: sha256(journalAfterBytes) };
    await reloaded.close(); reloadedAppOwners.delete(reloaded);
    const { ProjectIdentities } = await import('../server/project-identity.ts');
    const retiredRun = await new ProjectIdentities(machines!).runReadonly(fixture.vmId, alpha.identity, session.id);
    assert.equal(retiredRun.phase, 'closed');
    assert.deepEqual({ ...retiredRun, phase: receipt.run.phase }, receipt.run);
    assert.deepEqual(retiredRun, retiredRecord.closure);
    proof.singleApp.retiredNativeRun = retiredRun;
    const closure = await python(`import os,json
births=${JSON.stringify(allProcesses.map((item: any) => ({ pid: item.pid, created: item.created })))}
def gone(row):
 try:raw=open('/proc/'+str(row['pid'])+'/stat').read().rsplit(')',1)[1].split()
 except FileNotFoundError:return True
 return raw[19]!=row['created']
group='/sys/fs/cgroup/'+${JSON.stringify(receipt.run.cgroupName)}
print(json.dumps({'originalProcessesAbsent':all(gone(row) for row in births),'exactGroupAbsent':not os.path.lexists(group),'runtimeAbsent':not os.path.lexists(${JSON.stringify(receipt.runtime)}),'homePreserved':os.path.isdir(${JSON.stringify(receipt.home)})}))`);
    assert.equal(closure.originalProcessesAbsent, true); assert.equal(closure.exactGroupAbsent, true); assert.equal(closure.runtimeAbsent, true); assert.equal(closure.homePreserved, true);
    assert.deepEqual(await snapshot(), before); proof.singleApp.physicalRetirement = closure;
    checked('single-app-exact-full-domain-retired-including-detached-child-and-runtime-with-home-preserved', closure);
    await naturalSingleAppChecks(helper);
  }

  async function naturalSingleAppChecks(helper: string) {
    phase('public-single-app-natural-exit-auto-retirement');
    const path = alpha.directory + '/single-app-natural-' + randomUUID() + '.json';
    const snapshot = async () => python(`import os,json,stat,errno
def item(path):
 s=os.lstat(path)
 try:acl=os.getxattr(path,'system.posix_acl_access').hex()
 except OSError as e:
  assert e.errno in (errno.ENODATA,errno.ENOTSUP);acl=None
 return {'path':path,'device':str(s.st_dev),'inode':str(s.st_ino),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'acl':acl}
print(json.dumps([item(path) for path in ${JSON.stringify([alpha.directory, alpha.directory + '/private.txt', ...(alpha.privateParent ? [alpha.privateParent, alpha.privateParent + '/sibling.txt'] : [])])}]))`);
    const before = await snapshot(); assert.equal(before[0].mode, 0o700); assert.equal(before[1].mode, 0o600);
    const expected = await guest('cat ' + quote(alpha.directory + '/private.txt'));
    const session = await desktops!.apps.start(fixture.vmId, { program: 'xterm',
      args: ['-e', '/usr/bin/python3', '-I', '-S', helper + '/single-app-probe.py', alpha.directory, path, expected, ' retained argument spaces 界 ', 'natural-exit'],
      resolution: '1024x768', clipboard: { copy: false, paste: false } });
    assert.notEqual(session.id, proof.singleApp.session.id); activeSingleApps.add(session.id);
    const { appReceiptSchema } = await import('../server/single-app-sandbox.ts');
    const { singleAppRunRecordSchema } = await import('../server/single-app-windows.ts');
    const metadataPath = '/var/lib/sakura/single-app-uid/' + session.id + '/session.json';
    const receipt = appReceiptSchema.parse(JSON.parse(await guest('cat ' + quote(metadataPath))));
    assert.equal(receipt.state, 'running'); assert.deepEqual(receipt.identity, alpha.identity);
    assert.equal(receipt.run.mode, 'independent'); assert.equal(receipt.run.runId, session.id); assert.equal(receipt.run.bootId, proof.bootId);
    assert.notEqual(receipt.uid, proof.singleApp.receipt.uid); assert.notEqual(receipt.uid, alpha.identity.uid);
    const observed = JSON.parse(await marker(path)), detached = JSON.parse(await marker(path + '.detached'));
    assert.equal(observed.passed, true, JSON.stringify(observed)); assert.equal(observed.mode, 'natural-exit');
    assert.equal(detached.passed, true, JSON.stringify(detached)); assert.equal(detached.pid, observed.detachedPid);
    assert.equal(detached.sid, detached.pid); assert.notEqual(observed.sid, detached.sid);
    const processes = await singleAppProcesses(receipt);
    for (const row of [observed, detached]) {
      assert.equal(row.uid, receipt.uid); assert.equal(row.gid, receipt.gid); assert.equal(row.home, receipt.home); assert.equal(row.user, receipt.user);
      assert.equal(row.homeDevice, receipt.homeDevice); assert.equal(row.homeInode, receipt.homeInode);
      assert.equal(row.cgroup, '0::/' + receipt.run.cgroupName + '\n');
      assert.equal(row.networkDevice, receipt.run.networkDevice); assert.equal(row.networkInode, receipt.run.networkInode);
      assert.equal(row.mountDevice, receipt.directoryView!.device); assert.equal(row.mountInode, receipt.directoryView!.inode);
      assert.equal(processes.find((item: any) => item.pid === row.pid)?.created, row.created);
    }
    const descriptorObservation = await singleAppFdObservation(receipt, processes, 'natural-exit');
    const ports = await windowPortChecks(receipt, path); assert.deepEqual(await snapshot(), before);
    const { password: _password, ...publicSession } = session, { password: _receiptPassword, ...publicReceipt } = receipt;
    proof.naturalSingleApp = { session: publicSession, receipt: publicReceipt, observed, detached, processes, ports, descriptorObservation,
      originalOwnerModeAclBefore: before, watcherBudgetMilliseconds: 150000, directStopBeforeAutomaticRetirement: false };
    await projectSignal(path + '.exit.start', { version: 1, kind: 'owned-single-app-normal-exit', marker: path, pid: observed.pid, created: observed.created });
    const actualWait = JSON.parse(await marker(path + '.main-exit'));
    assert.equal(actualWait.passed, true, JSON.stringify(actualWait)); assert.equal(actualWait.actualWaitPid, observed.pid);
    assert.equal(actualWait.workerPid, observed.pid); assert.equal(actualWait.rawWaitStatus, 0); assert.equal(actualWait.normalExitCode, 0);
    assert.equal(processes.find((item: any) => item.pid === actualWait.supervisor.pid)?.created, actualWait.supervisor.created);
    proof.naturalSingleApp.mainActualWait = actualWait;
    const journalPath = join(fixture.root, 'machines', fixture.vmId, 'single-app-runs.json'), until = Date.now() + 150000;
    let closed: ReturnType<typeof singleAppRunRecordSchema.parse> | undefined, journalBytes: Buffer | undefined;
    while (Date.now() < until) {
      journalBytes = await readFile(journalPath);
      const journal = JSON.parse(journalBytes.toString()); assert.equal(journal.version, 1); assert.equal(journal.sessions.length, 2);
      const row = singleAppRunRecordSchema.parse(journal.sessions.find((item: any) => item.id === session.id));
      assert.deepEqual(row.run, receipt.run); assert.deepEqual(row.identity, receipt.identity);
      if (row.phase === 'stopped') { closed = row; break; }
      assert.notEqual(row.phase, 'cleanup-failed', row.lastError); await delay(250);
    }
    assert.ok(closed, 'Start-own host watcher did not confirm the original full-run retirement within its fixed budget');
    assert.equal(closed.closure!.phase, 'closed'); assert.equal(closed.receipt!.state, 'stopped'); assert.equal(closed.retirement, null);
    assert.deepEqual({ ...closed.closure, phase: receipt.run.phase }, receipt.run);
    const { ProjectIdentities } = await import('../server/project-identity.ts');
    const retiredRun = await new ProjectIdentities(machines!).runReadonly(fixture.vmId, alpha.identity, session.id);
    assert.deepEqual(retiredRun, closed.closure);
    const closure = await python(`import os,json,pwd,stat
births=${JSON.stringify(processes.map((item: any) => ({ pid: item.pid, created: item.created })))}
def gone(row):
 try:raw=open('/proc/'+str(row['pid'])+'/stat').read().rsplit(')',1)[1].split()
 except FileNotFoundError:return True
 return raw[19]!=row['created']
home=os.lstat(${JSON.stringify(receipt.home)});account=pwd.getpwnam(${JSON.stringify(receipt.user)})
print(json.dumps({'originalProcessesAbsent':all(gone(row) for row in births),'exactGroupAbsent':not os.path.lexists('/sys/fs/cgroup/'+${JSON.stringify(receipt.run.cgroupName)}),'runtimeAbsent':not os.path.lexists(${JSON.stringify(receipt.runtime)}),'accountUid':account.pw_uid,'accountGid':account.pw_gid,'homeDevice':str(home.st_dev),'homeInode':str(home.st_ino),'homeUid':home.st_uid,'homeGid':home.st_gid,'homeMode':stat.S_IMODE(home.st_mode)}))`);
    assert.equal(closure.originalProcessesAbsent, true); assert.equal(closure.exactGroupAbsent, true); assert.equal(closure.runtimeAbsent, true);
    assert.equal(closure.accountUid, receipt.uid); assert.equal(closure.accountGid, receipt.gid);
    assert.equal(closure.homeUid, receipt.uid); assert.equal(closure.homeGid, receipt.gid); assert.equal(closure.homeMode, 0o700);
    assert.equal(closure.homeDevice, receipt.homeDevice); assert.equal(closure.homeInode, receipt.homeInode); assert.deepEqual(await snapshot(), before);
    const created = await python(`import os,json,stat
print(json.dumps([{'path':path,'uid':os.lstat(path).st_uid,'gid':os.lstat(path).st_gid,'mode':stat.S_IMODE(os.lstat(path).st_mode),'text':open(path).read()} for path in ${JSON.stringify([alpha.directory + '/single-app-natural-relative.txt', alpha.directory + '/single-app-natural-absolute.txt'])}]))`);
    for (const row of created) { assert.equal(row.uid, alpha.identity.uid); assert.equal(row.gid, alpha.identity.gid); assert.equal(row.mode, 0o600); }
    proof.naturalSingleApp.automaticRetirement = { closure, retiredRun, hostJournalSha256: sha256(journalBytes!), created };
    activeSingleApps.delete(session.id);
    const view = (await desktops!.apps.list(fixture.vmId)).find(item => item.id === session.id)!;
    assert.equal(view.status, 'stopped'); assert.equal(view.cleanupPending, false);
    checked('natural-xterm-normal-exit-start-own-watcher-retires-original-full-domain-and-detached-child-with-home-account-preserved', proof.naturalSingleApp);
  }

  async function waylandPublicChecks(helper: string, desktop: Awaited<ReturnType<typeof binding>>, parent: string) {
    phase('actual-wayland-kernel-filesystem-preflight');
    const upload = async (local: string, name: string) => {
      const bytes = await readFile(join(workspace, local));
      assert.equal(sha256(bytes), proof.sourceBefore[local]);
      await guest(`set -eu; printf %s ${quote(bytes.toString('base64'))} | base64 -d > ${quote(helper + '/' + name)}; chmod 644 ${quote(helper + '/' + name)}`);
    };
    await upload('scripts/smoke-wayland-directory-view-linux.py', 'directory-view-preflight.py');
    await upload('scripts/linux-desktop-directory-probe.py', 'directory-probe.py');
    const source = '/usr/local/lib/sakura-wayland-clipboard/' + proof.clipboardBuild;
    proof.directoryViewPreflight = JSON.parse(await guest(`/usr/bin/python3 -I -S ${quote(helper + '/directory-view-preflight.py')} --source ${quote(source)}`, 120000));
    assert.equal(proof.directoryViewPreflight.passed, true); assert.equal(proof.directoryViewPreflight.cases.length, 8);
    assert.equal(proof.directoryViewPreflight.controllerSha256, proof.sourceBefore['native/wayland-clipboard/controller.py']);
    assert.equal(proof.directoryViewPreflight.smokeSha256, proof.sourceBefore['scripts/smoke-wayland-directory-view-linux.py']);
    for (const name of ['private-leaf', 'private-ancestor-route']) {
      const test = proof.directoryViewPreflight.cases.find((item: any) => item.case === name)!;
      assert.equal(test.passed, true); assert.equal(test.originalOwnerModeAclUnchanged, true);
      assert.equal(test.executable.originalMountRefusal.errno, 13);
      assert.equal(test.executable.originalMountRefusal.originalMountFdExecutionDenied, true);
      assert.equal(test.executable.originalMountRefusal.actualChildWait, true); assert.equal(test.executable.originalMountRefusal.childStatus, 0);
      assert.equal(test.executable.mappedMountExecution.productionMappedFdBootstrapExecuted, true);
      assert.equal(test.executable.mappedMountExecution.rootFdsClosedAfterExec, true);
      assert.equal(test.executable.mappedMountExecution.noNewPrivs, true);
      assert.equal(test.executable.mappedMountExecution.effectiveCapabilitiesEmpty, true);
      assert.equal(test.executable.mappedMountExecution.actualChildWait, true); assert.equal(test.executable.mappedMountExecution.childStatus, 0);
      assert.equal(test.executable.mappedMountExecution.dataHex, Buffer.from('changed').toString('hex'));
    }
    checked('actual-current-wayland-idmap-helper-kernel-filesystem-and-rejection-preflight', proof.directoryViewPreflight);
    await upload('native/wayland-clipboard/fixture-qt.cpp', 'fixture-qt.cpp');
    await upload('native/wayland-clipboard/fixture-gtk.c', 'fixture-gtk.c');
    await guest(`set -eu; cd ${quote(helper)}; g++ -std=c++17 -O2 -fPIC -Wall -Wextra fixture-qt.cpp -o fixture-qt $(pkg-config --cflags --libs Qt5Gui); gcc -O2 -Wall -Wextra fixture-gtk.c -o fixture-gtk $(pkg-config --cflags --libs gtk+-3.0); chmod 755 fixture-qt fixture-gtk`, 120000);
    // The new 0700 application images are created by the real project UID.
    // Root never changes project owner/mode to make these apps executable.
    const { projectIdentityTask } = await import('../server/project-run-scope.ts');
    const task = await projectIdentityTask(machines!, fixture.vmId, await spaces!.resolvedConfig(fixture.vmId), {
      command: `set -eu\numask 077\ncp ${quote(helper + '/fixture-qt')} ./wayland-qt\ncp ${quote(helper + '/fixture-gtk')} ./wayland-gtk\ncp /usr/bin/python3 ./directory-python\nchmod 700 ./wayland-qt ./wayland-gtk ./directory-python\n`,
    }, new AbortController().signal, undefined, 30000);
    assert.equal(task.code, 0, task.stderr || task.stdout);
    proof.privateElfPreparation = task;
    const programs = { qt: alpha.directory + '/wayland-qt', gtk: alpha.directory + '/wayland-gtk', python: alpha.directory + '/directory-python' };
    const protectedPaths = [alpha.directory, alpha.directory + '/private.txt', parent + '/sibling.txt', ...Object.values(programs), parent];
    async function snapshot() {
      return python(`import os,json,stat,errno
def inspect(path):
 s=os.lstat(path)
 try:acl=os.getxattr(path,'system.posix_acl_access').hex()
 except OSError as e:
  assert e.errno in (errno.ENODATA,errno.ENOTSUP);acl=None
 return {'path':path,'device':str(s.st_dev),'inode':str(s.st_ino),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'type':stat.S_IFMT(s.st_mode),'acl':acl}
print(json.dumps([inspect(path) for path in ${JSON.stringify(protectedPaths)}]))`);
    }
    proof.privateDirectoryBefore = await snapshot();
    assert.equal(proof.privateDirectoryBefore[0].mode, 0o700); assert.equal(proof.privateDirectoryBefore[1].mode, 0o600);
    assert.equal(proof.privateDirectoryBefore.at(-1).mode, 0o700); assert.equal(proof.privateDirectoryBefore.at(-1).uid, alpha.identity.uid);
    for (const image of Object.values(programs)) {
      const row = proof.privateDirectoryBefore.find((item: any) => item.path === image)!;
      assert.equal(row.uid, alpha.identity.uid); assert.equal(row.gid, alpha.identity.gid); assert.equal(row.mode, 0o700);
    }
    for (const image of Object.values(programs)) await save(image);
    const compositor = await python(`import os,json,stat
pid=${desktop.execution.endpoint!.plasmaPid};env=dict(item.split('=',1) for item in open('/proc/'+str(pid)+'/environ','rb').read().decode().split('\\0') if '=' in item)
assert env['XDG_SESSION_TYPE']=='wayland';endpoint=os.path.join(env['XDG_RUNTIME_DIR'],env['WAYLAND_DISPLAY']);s=os.lstat(endpoint);assert stat.S_ISSOCK(s.st_mode) and s.st_uid==${alpha.identity.uid}
print(json.dumps({'socket':endpoint,'device':str(s.st_dev),'inode':str(s.st_ino),'uid':s.st_uid,'kernel':os.uname().release}))`);
    proof.compositorDiscovery = compositor;
    const viewMarker = alpha.directory + '/directory-view-' + fixture.invocation + '.json';
    const directoryApp = await launch(programs.python, ['-I', '-S', helper + '/directory-probe.py', alpha.directory, viewMarker, compositor.socket, parent + '/sibling.txt']);
    const observed = JSON.parse(await marker(viewMarker));
    assert.equal(observed.passed, true, JSON.stringify(observed));
    assert.equal(observed.uid, directoryApp.applicationOwner!.uid); assert.notEqual(observed.uid, alpha.identity.uid);
    assert.equal(observed.absoluteAndRelativeReadWrite, true); assert.equal(observed.directCompositorDenied, true);
    assert.equal(observed.privateAncestorSiblingHidden, true); assert.equal(observed.productProxySyncAcknowledged, true);
    const state = JSON.parse(await readFile(join(fixture.root, 'machines', fixture.vmId, 'wayland-clipboard.json'), 'utf8'));
    const metadataDirectory = '/var/lib/sakura/wayland-clipboard/' + state.owner + '/' + directoryApp.id;
    const metadata = JSON.parse(await guest('cat ' + quote(metadataDirectory + '/session.json')));
    assert.equal(metadata.version, 2); assert.equal(metadata.uid, observed.uid); assert.equal(metadata.compositorSocket, compositor.socket);
    assert.equal(metadata.directoryView.inode, observed.mountNamespace); assert.equal(metadata.directoryView.projectUid, alpha.identity.uid);
    assert.equal(metadata.directoryView.directoryDevice, alpha.identity.directoryDevice); assert.equal(metadata.directoryView.directoryInode, alpha.identity.directoryInode);
    assert.equal(metadata.directoryView.directoryMode, 0o700); assert.equal(metadata.directoryView.mountFlags & 6, 6);
    assert.equal(metadata.directoryView.desktopRunId, desktop.execution.run!.runId); assert.equal(metadata.directoryView.bootId, desktop.execution.run!.bootId);
    assert.ok(metadata.directoryView.route);
    proof.directoryApplication = { session: directoryApp, metadata, observed };
    proof.privateDirectoryAfter = await snapshot(); assert.deepEqual(proof.privateDirectoryAfter, proof.privateDirectoryBefore);
    proof.createdProjectFiles = await python(`import os,json,stat
directory=${JSON.stringify(alpha.directory)}
print(json.dumps([{'path':path,'uid':os.lstat(path).st_uid,'gid':os.lstat(path).st_gid,'mode':stat.S_IMODE(os.lstat(path).st_mode),'text':open(path).read()} for path in [directory+'/created-relative.txt',directory+'/created-absolute.txt']]))`);
    for (const row of proof.createdProjectFiles) { assert.equal(row.uid, alpha.identity.uid); assert.equal(row.gid, alpha.identity.gid); assert.equal(row.mode, 0o600); }
    checked('public-wayland-independent-uid-private-elf-and-0700-directory-read-write-with-unchanged-owner-mode-acl', proof.directoryApplication);
    await stopApp(directoryApp.id);
    const closed = await python(`import os,json
paths=${JSON.stringify([metadata.applicationCgroup, metadata.brokerCgroup])}
print(json.dumps({'groupsEmpty':all(not os.path.exists(path) or not open(path+'/cgroup.procs').read().strip() for path in paths),'proxySocketAbsent':not os.path.lexists(${JSON.stringify(metadata.socket)})}))`);
    assert.equal(closed.groupsEmpty, true); assert.equal(closed.proxySocketAbsent, true);
    checked('private-directory-application-domain-and-proxy-physically-stopped', closed);
    const mime = 'text/plain;charset=utf-8', input = helper + '/text.txt';
    const text = Buffer.from('current independent Wayland project clipboard 界é');
    await guest(`set -eu; printf %s ${quote(text.toString('base64'))} | base64 -d > ${quote(input)}; chmod 644 ${quote(input)}`);
    const focus = async () => {
      assert.equal((await desktops!.view(fixture.vmId, true)).status, 'ready');
      await guest(`set -eu; sleep .4; env DISPLAY=:1 XAUTHORITY=${quote(desktop.execution.runtime + '/Xauthority')} xdotool mousemove 640 400 click 1 key F8`);
    };
    let serial = 0;
    async function owner(toolkit: 'qt' | 'gtk') {
      const path = alpha.directory + '/wayland-owner-' + (++serial);
      const session = await launch(programs[toolkit], ['owner', input, path, mime]);
      await focus(); assert.match(await marker(path), /^READY (wayland|gtk-wayland)/); return session;
    }
    async function sink(toolkit: 'qt' | 'gtk', expected: string) {
      const path = alpha.directory + '/wayland-sink-' + (++serial);
      const session = await launch(programs[toolkit], ['probe', '/dev/null', path, mime]);
      try { await focus(); assert.equal(await marker(path), expected); } finally { await stopApp(session.id); }
      return session;
    }
    for (const [from, to] of [['qt', 'gtk'], ['gtk', 'qt']] as const) {
      const sourceApp = await owner(from); await sink(to, text.toString('hex'));
      checked('current-private-owner-only-elf-native-wayland-' + from + '-to-' + to);
      await save(programs[from], { ...defaultClipboardRule(), copy: false });
      await sink(to, 'DENIED');
      const denied = (await clipboard().view(fixture.vmId)).sessions.find((item) => item.id === sourceApp.id)!;
      assert.ok(denied.blockedCopy! > 0); checked('native-wayland-live-copy-denial-' + from, denied);
      await save(programs[from]); await save(programs[to], { ...defaultClipboardRule(), paste: false });
      const deniedSink = await sink(to, 'DENIED');
      const pasteDenied = (await clipboard().view(fixture.vmId)).sessions.find((item) => item.id === deniedSink.id)!;
      assert.ok(pasteDenied.blockedPaste! > 0); checked('native-wayland-paste-denial-' + to, pasteDenied);
      await save(programs[to]); await sink(to, text.toString('hex'));
      await stopApp(sourceApp.id);
    }
    assert.deepEqual(await snapshot(), proof.privateDirectoryBefore);
  }

  try {
    phase('source-read-guards-and-new-cow');
    const sourceMetadata = JSON.parse(await readFile(join(workspace, 'native/wayland-clipboard/sources.json'), 'utf8'));
    assert.equal(sourceMetadata.version, 1); assert.equal(sourceMetadata.files.length, 17);
    const waylandNames = ['controller.py', 'proxy.py', 'sources.json', ...sourceMetadata.files.map((file: any) => file.name)] as string[];
    assert.equal(new Set(waylandNames).size, 20);
    for (const name of waylandNames) assert.match(name, /^[a-z0-9-]+\.(py|json|xml)$/);
    const assetFiles = [
      ...['project-identity', 'linux-clipboard', 'wayland-clipboard', 'single-app'].map((folder) => '.sakura-server/assets/' + folder + '/manifest.json'),
      ...['protocol.h', 'launcher.c', 'controller.py'].map((name) => '.sakura-server/assets/project-identity/' + name),
      ...['protocol.h', 'policy.cpp', 'controller.py'].map((name) => '.sakura-server/assets/linux-clipboard/' + name),
      ...waylandNames.flatMap((name) => ['native/wayland-clipboard/' + name, '.sakura-server/assets/wayland-clipboard/' + name]),
      ...['controller.py', 'directory-view.py', 'sources.json'].flatMap((name) => ['native/single-app/' + name, '.sakura-server/assets/single-app/' + name]),
    ];
    for (const folder of ['project-identity', 'linux-clipboard', 'wayland-clipboard', 'single-app']) {
      const packaged = JSON.parse(await readFile(join(workspace, '.sakura-server/assets', folder, 'manifest.json'), 'utf8'));
      const expectedNames = folder === 'project-identity' ? ['protocol.h', 'launcher.c', 'controller.py']
        : folder === 'linux-clipboard' ? ['protocol.h', 'policy.cpp', 'controller.py']
          : folder === 'single-app' ? ['controller.py', 'directory-view.py', 'sources.json'] : waylandNames;
      assert.equal(packaged.version, 1); assert.match(packaged.build, /^[a-f0-9]{64}$/);
      assert.equal(packaged.files.length, expectedNames.length);
      assert.deepEqual(new Set(packaged.files.map((file: any) => file.name)), new Set(expectedNames));
      for (const entry of packaged.files) {
        const bytes = await readFile(join(workspace, '.sakura-server/assets', folder, entry.name));
        assert.equal(sha256(bytes), entry.sha256); assert.equal(bytes.length, entry.size);
        assert.equal(sha256(await readFile(join(workspace, 'native', folder, entry.name))), entry.sha256, 'Packaged asset is not current native source: ' + folder + '/' + entry.name);
      }
    }
    proof.sourceBefore = await captureDesktopSources(workspace, ['scripts/smoke-project-desktop-identity.ts', 'scripts/linux-desktop-owned-fixture.ps1',
      'native/project-identity/protocol.h', 'native/project-identity/launcher.c', 'native/project-identity/controller.py',
      'native/linux-clipboard/controller.py', 'native/linux-clipboard/policy.cpp', 'native/linux-clipboard/fixture.cpp', 'native/linux-clipboard/fixture-qt.cpp',
      'scripts/linux-desktop-directory-probe.py', 'scripts/linux-desktop-single-app-probe.py', 'scripts/smoke-wayland-directory-view-linux.py',
      'tests/linux-desktop-owned-fixture.test.ts', 'tests/desktop.test.ts',
      'native/wayland-clipboard/fixture-qt.cpp', 'native/wayland-clipboard/fixture-gtk.c',
      'server/project-repository-broker.py', 'package.json', 'package-lock.json', 'scripts/smoke-single-app-windows.ts',
      'node_modules/ssh2/package.json', 'node_modules/tsx/package.json',
      'node_modules/@novnc/novnc/core/crypto/des.js', 'node_modules/@novnc/novnc/package.json', ...assetFiles]);
    proof.historicalEntrypoint = { path: 'scripts/smoke-single-app-windows.ts', sha256: proof.sourceBefore['scripts/smoke-single-app-windows.ts'], executed: false };
    proof.chains = await fixture.prepare(); proof.sourceGuardBefore = fixture.before;
    process.env.SAKURA_DATA_DIR = fixture.root; process.env.TEMP = process.env.TMP = fixture.root;
    const { Machines } = await import('../server/machines.ts');
    const { createSshKey } = await import('../server/seed.ts');
    const { Workspaces, projectSchema } = await import('../server/workspaces.ts');
    const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
    const { ProjectRunScopes } = await import('../server/project-run-scope.ts');
    const { Desktops } = await import('../server/desktop.ts');
    const { writeStore } = await import('../server/local-store.ts');
    const freshKey = createSshKey(), vmDirectory = join(fixture.root, 'machines', fixture.vmId);
    await writeFile(join(vmDirectory, 'id_rsa'), freshKey.privateText, { flag: 'wx', mode: 0o600 });
    const seed = await readFile(join(fixture.sourceRoot, 'machines', desktopFixtureSource.vmId, 'seed.iso'));
    assert.equal(sha256(seed), fixture.before.snapshot.files.find((entry: any) => entry.path === join(fixture.sourceRoot, 'machines', desktopFixtureSource.vmId, 'seed.iso')).sha256);
    await writeFile(join(vmDirectory, 'seed.iso'), seed, { flag: 'wx' });
    await writeFile(join(fixture.root, 'machines.json'), JSON.stringify([{ id: fixture.vmId, name: 'desktop-uid-' + fixture.invocation.slice(0, 8),
      memoryMiB: 2048, cpus: 2, diskGiB: 6, distro: 'debian', accelerator: 'tcg', forwards: [], snapshots: [], bootstrapped: true,
      createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString() }], null, 2), { flag: 'wx' });
    machines = new Machines(fixture.engine());
    const originalConnect = Reflect.get(machines, 'connectOnce');
    Reflect.set(machines, 'connectOnce', (...args: unknown[]) => {
      const pending = Reflect.apply(originalConnect, machines, args);
      for (const client of Reflect.get(args[0] as object, 'clients') as Set<Client>) watchClient(client, 'production', args[0] as object);
      return pending;
    });
    await machines.init(); await machines.start(fixture.vmId);
    phase('owned-key-bootstrap-and-fresh-authentication');
    oldKey = await readFile(join(fixture.sourceRoot, 'machines', desktopFixtureSource.vmId, 'id_rsa'));
    assert.equal(sha256(oldKey), fixture.before.snapshot.files.find((entry: any) => entry.path === join(fixture.sourceRoot, 'machines', desktopFixtureSource.vmId, 'id_rsa')).sha256);
    const until = Date.now() + 180000;
    let bootstrap: Client | undefined;
    while (Date.now() < until) {
      assert.ok(machines.live.has(fixture.vmId) && fixture.qemuRunning, machines.logs.get(fixture.vmId) || 'Owned QEMU is not running');
      const candidate = new ssh2.Client(); watchClient(candidate, 'in-memory-original-test-key-bootstrap');
      try {
        await new Promise<void>((done, reject) => { candidate.once('ready', done); candidate.once('error', reject);
          candidate.connect({ host: '127.0.0.1', port: machines!.live.get(fixture.vmId)!.sshPort, username: 'root', privateKey: oldKey, readyTimeout: 4000 }); });
        bootstrap = candidate; break;
      } catch { await closeClient(candidate); await delay(1000); }
    }
    assert.ok(bootstrap, 'Owned source test-key bootstrap failed');
    async function bootstrapCommand(source: string, input = '') {
      return new Promise<string>((done, reject) => bootstrap!.exec('env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /bin/sh -c ' + quote(source), (error, channel) => {
      if (error) return reject(error); let stdout = '', stderr = '';
      const timer = setTimeout(() => { channel.close(); reject(new Error('Owned bootstrap command timeout')); }, 15000);
      channel.on('data', (bytes: Buffer) => { stdout += bytes.toString(); }); channel.stderr.on('data', (bytes: Buffer) => { stderr += bytes.toString(); });
      channel.once('close', (code: number) => { clearTimeout(timer); if (code !== 0) reject(new Error(stderr)); else done(stdout); });
      channel.end(input);
      }));
    }
    // Establish the owned guest tuple before the first mutation. The rekey
    // repeats it on the same actual transport immediately before writing.
    const ids = await bootstrapCommand('set -eu; test -f /var/lib/cloud/instance/boot-finished; cat /sys/class/dmi/id/product_uuid; cat /proc/sys/kernel/random/boot_id');
    const [dmi, boot] = ids.trim().split(/\r?\n/); assert.equal(dmi.toLowerCase(), fixture.vmId); assert.match(boot, /^[a-f0-9-]{36}$/); proof.bootId = boot;
    const rekey = `set -eu\ntest "$(cat /sys/class/dmi/id/product_uuid | tr A-F a-f)" = ${quote(fixture.vmId)}\ntest "$(cat /proc/sys/kernel/random/boot_id)" = ${quote(boot)}\ntest ! -L /root/.ssh/authorized_keys\numask 077\nIFS= read -r key\ntest -n "$key"\nprintf '%s\\n' "$key" > /root/.ssh/authorized_keys.sakura-current-cow\nchmod 600 /root/.ssh/authorized_keys.sakura-current-cow\nmv /root/.ssh/authorized_keys.sakura-current-cow /root/.ssh/authorized_keys\n/bin/sync\n`;
    await bootstrapCommand(rekey, freshKey.publicText + '\n');
    await closeClient(bootstrap); oldKey.fill(0); oldKey = undefined;
    const bootUntil = Date.now() + 120000;
    while (machines.state(fixture.vmId) === 'starting' && Date.now() < bootUntil) await delay(500);
    assert.equal(machines.state(fixture.vmId), 'running', machines.logs.get(fixture.vmId));
    assert.equal(await guest('cat /sys/class/dmi/id/product_uuid'), fixture.vmId);
    proof.legacyBaseline = await guest('systemctl show sakura-desktop -p LoadState -p ActiveState -p UnitFileState -p FragmentPath; if systemctl cat sakura-desktop >/dev/null 2>&1; then systemctl cat sakura-desktop; fi');
    // This exact inherited fixture service is retired only in the new COW.
    // No old host binding is copied, adopted or silently migrated.
    await guest('set -eu; if systemctl cat sakura-desktop >/dev/null 2>&1; then systemctl disable --now sakura-desktop; fi; ! systemctl is-active --quiet sakura-desktop');
    spaces = new Workspaces(machines); const migrations = new ProjectDirectoryMigrations(machines, spaces);
    const directoryParent = '/srv/projects/sakura-desktop-identity-' + fixture.invocation;
    await guest(`set -eu; test ! -L /srv/projects; if [ ! -e /srv/projects ]; then mkdir /srv/projects; chmod 755 /srv/projects; fi; mkdir ${quote(directoryParent)}; chmod 711 ${quote(directoryParent)}`);
    async function project(name: string) {
      const directory = directoryParent + '/' + name;
      await guest(`set -eu; mkdir ${quote(directory)}; chmod 700 ${quote(directory)}; printf %s ${quote('owned-' + name)} > ${quote(directory + '/private.txt')}; chmod 600 ${quote(directory + '/private.txt')}`);
      const config = projectSchema.parse({ directory, networkIsolation: 'private', template: 'none', environment: { SAKURA_CURRENT_UID_PROBE: fixture.invocation, HOME: '/root', DISPLAY: ':99' } });
      const index = await spaces!.projects.create(fixture.vmId, name + '-' + fixture.invocation, () => writeStore(spaces!.projects.file(fixture.vmId), config));
      return spaces!.projects.with(fixture.vmId, index.active, async () => {
        let preview;
        try { preview = await migrations.preview(fixture.vmId); }
        catch (error) {
          proof.admissionRefusal = errorValue(error);
          if (Reflect.get(error as object, 'code') !== 'PROJECT_IDENTITY_EGRESS_NNP_RESTART_REQUIRED') throw error;
          proof.admissionServicesBefore = await guest('systemctl show ssh.service cron.service -p Id -p FragmentPath -p ActiveState -p NoNewPrivileges -p MainPID');
          await guest('set -eu; systemctl restart ssh.service; systemctl restart cron.service');
          preview = await migrations.preview(fixture.vmId);
        }
        assert.ok(preview.plan);
        const applied = await migrations.apply(fixture.vmId, { action: 'apply', version: 1, planId: preview.plan.proposal.planId, sha256: preview.plan.sha256, reviewed: true });
        assert.ok(applied.plan);
        assert.equal(applied.plan.state, 'applied'); assert.ok(applied.plan.activatedIdentity);
        proof.migrations ||= []; proof.migrations.push({ preview, applied });
        return { id: index.active, directory, identity: applied.plan.activatedIdentity };
      });
    }
    phase('real-project-directory-migration-and-uid-admission');
    alpha = await project('alpha'); beta = await project('beta'); assert.notEqual(alpha.identity.uid, beta.identity.uid);
    if (transport === 'wayland') {
      // The original project UID must traverse its own private ancestor. Root
      // does not make an inaccessible Root-owned parent traversable later.
      // Public migration first owns the outer 0700 tree, then an actual project
      // task creates the nested tree and public rebind fixes its exact inode.
      await spaces.projects.with(fixture.vmId, alpha.id, async () => {
        const { projectIdentityTask } = await import('../server/project-run-scope.ts');
        const prepared = await projectIdentityTask(machines!, fixture.vmId, await spaces!.resolvedConfig(fixture.vmId), {
          command: "set -eu\numask 077\nmkdir current\nprintf %s owned-alpha > current/private.txt\nprintf %s private-sibling > sibling.txt\n",
        }, new AbortController().signal, undefined, 30000);
        assert.equal(prepared.code, 0, prepared.stderr || prepared.stdout);
        const outer = alpha.directory, originalIdentity = structuredClone(alpha.identity);
        const { _workspace: _context, ...originalConfig } = await spaces!.config(fixture.vmId);
        const config = projectSchema.parse({ ...originalConfig, directory: outer + '/current' });
        await writeStore(spaces!.projects.file(fixture.vmId), config);
        const preview = await migrations.preview(fixture.vmId); assert.ok(preview.plan);
        const applied = await migrations.apply(fixture.vmId, { action: 'apply', version: 1, planId: preview.plan.proposal.planId, sha256: preview.plan.sha256, reviewed: true });
        assert.equal(applied.plan?.state, 'applied'); assert.ok(applied.plan?.activatedIdentity);
        for (const key of ['uid', 'gid', 'account', 'identityId', 'home', 'homeDevice', 'homeInode'])
          assert.equal(Reflect.get(applied.plan.activatedIdentity, key), Reflect.get(originalIdentity, key));
        alpha = { ...alpha, directory: config.directory, privateParent: outer, identity: applied.plan.activatedIdentity };
        proof.privateAncestorPreparation = { originalIdentity, task: prepared, preview, applied };
      });
    }
    desktops = new Desktops(machines, spaces);
    await spaces.projects.with(fixture.vmId, alpha.id, async () => {
      phase('public-current-uid-desktop-start');
      desktops!.start(fixture.vmId, 'start', { sessionType: transport }); await ready();
      const initial = await observeDesktop(); checked('full-v2-desktop-native-ticket-real-project-uid', initial.execution);
      phase('public-' + transport + '-bundle-install-and-owned-program-build');
      clipboard().install(fixture.vmId); await clipboard().jobs.wait(fixture.vmId);
      const installed = clipboard().jobs.view(fixture.vmId)!; assert.equal(installed.status, 'done', installed.error + '\n' + installed.log);
      const installedView = await clipboard().view(fixture.vmId);
      assert.equal(installedView.ready, true);
      proof.clipboardBuild = installedView.build;
      const helper = '/usr/local/lib/sakura-desktop-identity-fixture-' + fixture.invocation;
      await guest(`set -eu; mkdir ${quote(helper)}; chmod 755 ${quote(helper)}`);
      if (transport === 'wayland') {
        await waylandPublicChecks(helper, initial, alpha.privateParent);
      } else {
      for (const name of ['fixture.cpp', 'fixture-qt.cpp']) {
        const bytes = await readFile(join(workspace, 'native/linux-clipboard', name));
        assert.equal(sha256(bytes), proof.sourceBefore['native/linux-clipboard/' + name]);
        await guest(`set -eu; printf %s ${quote(bytes.toString('base64'))} | base64 -d > ${quote(helper + '/' + name)}; chmod 644 ${quote(helper + '/' + name)}`);
      }
      const program = helper + '/fixture', qtProgram = helper + '/fixture-qt', data = helper + '/text.txt';
      await guest(`set -eu; cd ${quote(helper)}; g++ -std=c++17 -O2 -Wall -Wextra fixture.cpp -o fixture -lX11 -lX11-xcb -lxcb -pthread; g++ -std=c++17 -O2 -fPIC -Wall -Wextra fixture-qt.cpp -o fixture-qt $(pkg-config --cflags --libs Qt5Gui) -lxcb; chmod 755 fixture fixture-qt; printf %s ${quote('current owned project clipboard 界é')} > text.txt; chmod 644 text.txt`, 120000);
      await save(program); await save(qtProgram);
      const ownerMarker = alpha.identity.home + '/current-x11-owner-' + fixture.invocation;
      const owner = await launch(program, ['xlib', 'owner', 'UTF8_STRING', data, 'CLIPBOARD', 'ordinary', ownerMarker]);
      assert.equal(await marker(ownerMarker), 'READY');
      proof.sourceApplication = owner;
      proof.applicationProcesses = await python(`import os,json
rows=json.loads(${JSON.stringify(JSON.stringify(owner.processes))})
def inspect(row):
 pid=row['pid'];s=dict(line.split(':',1) for line in open('/proc/'+str(pid)+'/status'))
 return {'pid':pid,'image':os.readlink('/proc/'+str(pid)+'/exe'),'created':open('/proc/'+str(pid)+'/stat').read().rsplit(')',1)[1].split()[19],'status':{k:s[k].strip() for k in ('Uid','Gid','Groups','NoNewPrivs','CapInh','CapPrm','CapEff','CapBnd','CapAmb')},'cgroup':open('/proc/'+str(pid)+'/cgroup').read(),'loaded':${JSON.stringify(program)}!=os.readlink('/proc/'+str(pid)+'/exe') or 'libSakuraClipboard.so' in open('/proc/'+str(pid)+'/maps').read()}
print(json.dumps([inspect(row) for row in rows]))`);
      assert.ok(proof.applicationProcesses.length > 0);
      for (const process of proof.applicationProcesses) {
        const original = owner.processes!.find((item) => item.pid === process.pid)!;
        assert.equal(process.created, original.created);
        assert.deepEqual(process.status.Uid.split(/\s+/).map(Number), Array(4).fill(alpha.identity.uid));
        assert.deepEqual(process.status.Gid.split(/\s+/).map(Number), Array(4).fill(alpha.identity.gid));
        assert.equal(process.status.Groups, '');
        assert.equal(process.status.NoNewPrivs, '1');
        for (const capability of ['CapInh', 'CapPrm', 'CapEff', 'CapAmb'])
          assert.equal(BigInt('0x' + process.status[capability]), 0n);
        assert.equal(process.loaded, true);
        assert.ok(process.cgroup.includes('sakura-clipboard-'));
      }
      checked('public-controlled-x11-app-uses-current-desktop-uid-and-home', owner);
      const text = Buffer.from('current owned project clipboard 界é').toString('hex');
      async function probe(label: string, expected: string) {
        const path = alpha.identity.home + '/' + label + '-' + fixture.invocation;
        const sink = await launch(qtProgram, ['probe', path, 'fixture']);
        try { assert.equal(await marker(path), expected); } finally { await stopApp(sink.id); }
        return sink;
      }
      await probe('clipboard-allowed', text); checked('real-qt-paste-current-home');
      await save(program, { ...defaultClipboardRule(), copy: false });
      await probe('clipboard-copy-denied', 'DENIED');
      const denied = (await clipboard().view(fixture.vmId)).sessions.find((item) => item.id === owner.id)!;
      assert.ok(denied.blockedCopy! > 0); checked('live-copy-policy-real-selection-denial-and-counter', denied);
      await save(program); await save(qtProgram, { ...defaultClipboardRule(), paste: false });
      const sink = await probe('clipboard-paste-denied', 'DENIED');
      const pasteDenied = (await clipboard().view(fixture.vmId)).sessions.find((item) => item.id === sink.id)!;
      assert.ok(pasteDenied.blockedPaste! > 0); checked('controlled-qt-paste-policy-and-counter', pasteDenied);
      await save(qtProgram); await probe('clipboard-restored', text); checked('live-policy-restoration');
      const wrong = await spaces!.projects.with(fixture.vmId, beta.id, async () => {
        try { await launch(qtProgram, ['probe', beta.identity.home + '/must-not-run', 'fixture']); return null; }
        catch (error) { return errorValue(error); }
      });
      assert.equal(wrong?.code, 'DESKTOP_SCOPE_CHANGED'); checked('other-project-cannot-adopt-desktop-ticket', wrong);
      await stopApp(owner.id);
      }
      await singleAppPublicChecks(helper);
      const runId = initial.execution.run!.runId;
      await desktops!.stop(fixture.vmId);
      const stopped = await binding(); assert.equal(stopped.state, 'stopped'); assert.equal(stopped.execution.record.phase, 'stopped');
      const scopes = new ProjectRunScopes(machines!); assert.equal(await scopes.active(fixture.vmId, alpha.id, runId), false);
      proof.retired = await python(`import os,json
print(json.dumps({'runtimeAbsent':not os.path.lexists(${JSON.stringify(initial.execution.runtime)}),'scopeAbsent':not os.path.lexists('/sys/fs/cgroup/'+${JSON.stringify(initial.execution.run!.cgroupName)})}))`);
      assert.equal(proof.retired.runtimeAbsent, true); assert.equal(proof.retired.scopeAbsent, true);
      checked('exact-app-desktop-scope-and-runtime-retirement', { stopped, retired: proof.retired });
      phase('current-uid-desktop-restart');
      desktops!.start(fixture.vmId, 'start', { sessionType: transport }); await ready();
      const restarted = await observeDesktop(); assert.notEqual(restarted.execution.run!.runId, runId);
      checked('restart-mints-new-full-domain-with-original-project-identity', restarted.execution);
      await desktops!.stop(fixture.vmId);
    });
    proof.functionalCompleted = true;
  } catch (error) { proof.error = errorValue(error); proof.errorStack = error instanceof Error ? error.stack : String(error); console.error(proof.errorStack); }
  finally {
    phase('exact-owned-cleanup');
    async function finish(name: string, action: () => Promise<unknown>) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([action(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(name + ' remains pending')), 30000); })]); }
      catch (error) { proof.cleanupErrors.push({ phase: name, ...errorValue(error) }); }
      finally { if (timer) clearTimeout(timer); }
    }
    if (machines?.live.has(fixture.vmId)) {
      for (const id of activeApps) await finish('app ' + id, () => stopApp(id));
      for (const id of activeSingleApps) await finish('single-app ' + id, () => desktops!.apps.stop(fixture.vmId, id));
      for (const owner of reloadedAppOwners) await finish('reloaded single-app owner close', () => owner.close());
      if (desktops) await finish('desktop retirement', () => desktops!.stop(fixture.vmId));
      await finish('guest sync', () => guest('/bin/sync', 15000));
    }
    for (const [socket, closed] of webSockets) {
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      await finish('WebSocket physical close', () => closed);
    }
    for (const server of webSocketServers) {
      for (const socket of server.clients) socket.terminate();
      await finish('WebSocket server physical close', () => new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())));
    }
    oldKey?.fill(0);
    // A retained cleanup ticket must not prevent physical owned-VM shutdown.
    // Any timed-out product cleanup stays a failure and is never inferred closed.
    if (machines?.live.has(fixture.vmId)) await finish('VM stop', () => machines!.stop(fixture.vmId, true));
    if (desktops) await finish('Desktop owner close', () => desktops!.close());
    if (spaces) await finish('workspace owner close', () => spaces!.close());
    if (machines) await finish('machine owner close', () => machines!.close());
    for (const client of clients) await finish('SSH client physical close', () => closeClient(client));
    await finish('SSH channel physical close', () => Promise.all(channelClosures.values()));
    try { await fixture.close(); } catch (error) { proof.cleanupErrors.push(errorValue(error)); }
    for (const [file, expected] of Object.entries(proof.sourceBefore)) {
      try { proof.sourceAfter[file] = sha256(await readFile(join(workspace, file))); assert.equal(proof.sourceAfter[file], expected, file); }
      catch (error) { proof.cleanupErrors.push(errorValue(error)); }
    }
    proof.sourceGuardAfter = fixture.after; proof.sourceUnchanged = fixture.guardReleased;
    proof.qemuOwner = fixture.qemuOwner; proof.vmStopped = !machines?.live.has(fixture.vmId) && !fixture.qemuRunning;
    proof.liveEntries = machines?.live.size || 0; proof.ownedChildren = fixture.children.size;
    proof.allSshClosed = proof.sshClients.every((row: any) => row.notCreated || row.closed) && proof.sshChannels.every((row: any) => row.notCreated || row.closed);
    proof.allWebSocketsClosed = proof.webSockets.every((row: any) => row.closed); proof.allWebSocketServersClosed = proof.webSocketServers.every((row: any) => row.closed);
    proof.finishedAt = new Date().toISOString();
    proof.passed = !!proof.functionalCompleted && !proof.error && !proof.cleanupErrors.length && proof.sourceUnchanged && proof.vmStopped && !proof.ownedChildren && proof.allSshClosed && proof.allWebSocketsClosed && proof.allWebSocketServersClosed;
    const file = fixture.rootExists ? join(fixture.root, 'desktop-identity-evidence.json') : join(desktopFixtureParent, 'desktop-identity-pre-guard-failure-' + fixture.invocation + '.json');
    await writeFile(file, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
    console.log('PROOF ' + file); console.log('SHA256 ' + sha256(await readFile(file)));
    if (!proof.passed) process.exitCode = 1;
  }
}
