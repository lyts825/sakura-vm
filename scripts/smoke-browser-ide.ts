import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ProjectIdentityRun } from '../server/project-identity.ts';

// This entry creates a fresh disposable VM. Historical Browser IDE root
// observations remain historical; only a new run can establish UID evidence.
const directory = await mkdtemp(join(tmpdir(), 'sakura-browser-ide-smoke-'));
const isolated = process.env.SAKURA_BROWSER_IDE_PRIVATE === '1';
const checkTerminal = process.env.SAKURA_BROWSER_IDE_TERMINAL === '1';
const projectDirectory = isolated ? '/workspace/private-ide' : '/workspace/browser-ide';
const marker = 'browser-ide-smoke-' + randomUUID();
const signal = new AbortController().signal;
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { BrowserIde, browserIdePackage, browserIdeSessionSchema } = await import('../server/browser-ide.ts');
const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
const { ProjectRunScopes } = await import('../server/project-run-scope.ts');
const { ProjectIdentities, projectIdentityRunSchema, projectIdentitySchema } = await import('../server/project-identity.ts');
const { ProjectBrowserIdeScope, projectBrowserIdeRecordSchema } = await import('../server/project-service-scope.ts');
const { quote } = await import('../server/files.ts');
const { vmDir } = await import('../server/model.ts');
const { freePort } = await import('../server/qmp.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);
const identities = new ProjectIdentities(machines);
const scopes = new ProjectRunScopes(machines);
let ide = new BrowserIde(machines, workspaces);
await ide.init();

// The root observer reads kernel metadata, receipts and bounded test JSON.
// The entire request (including expected environment) arrives through stdin.
const observer = String.raw`import glob,json,os,stat,sys
r=json.load(sys.stdin)
def read(path,limit=65536):
 fd=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  data=b''
  while len(data)<=limit:
   part=os.read(fd,min(4096,limit+1-len(data)))
   if not part:return data
   data+=part
  raise ValueError('smoke observation exceeded bound')
 finally:os.close(fd)
def process(pid):
 path='/proc/'+str(pid)
 try:
  before=read(path+'/stat',4096).rsplit(b')',1)[1].split()
  if before[0] in (b'Z',b'X',b'x'):return None
  status=dict(row.split(':',1) for row in read(path+'/status').decode().splitlines() if ':' in row)
  env=dict(row.split('=',1) for row in read(path+'/environ',131072).decode().split('\0') if '=' in row)
  net=os.stat(path+'/ns/net');socket_inodes=[]
  for name in os.listdir(path+'/fd'):
   try:target=os.readlink(path+'/fd/'+name)
   except (FileNotFoundError,ProcessLookupError):continue
   if target.startswith('socket:[') and target.endswith(']'):socket_inodes.append(target[8:-1])
  value={'pid':pid,'ticks':before[19].decode(),'uid':[int(v) for v in status['Uid'].split()],
   'gid':[int(v) for v in status['Gid'].split()],'groups':[int(v) for v in status['Groups'].split()],
   'home':env.get('HOME'),'marker':env.get('SAKURA_BROWSER_IDE_SMOKE'),
   'passwordMatches':env.get('PASSWORD')==r.get('password'),
   'networkDevice':str(net.st_dev),'networkInode':str(net.st_ino),
   'scope':read(path+'/cgroup',4096).decode().strip(),
   'command':read(path+'/cmdline').decode().replace('\0',' '),
   'caps':{k:status[k].strip() for k in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs')},
   'socketInodes':socket_inodes}
  after=read(path+'/stat',4096).rsplit(b')',1)[1].split()
  if before[19]!=after[19] or after[0] in (b'Z',b'X',b'x'):return None
  return value
 except (FileNotFoundError,ProcessLookupError):return None
boot=read('/proc/sys/kernel/random/boot_id',128).decode().strip()
if r['operation']=='report':
 info=os.lstat(r['path']);assert stat.S_ISREG(info.st_mode) and info.st_uid==r['uid'] and info.st_nlink==1
 print(json.dumps({'report':json.loads(read(r['path'])),'uid':info.st_uid,'gid':info.st_gid}));sys.exit()
run=r['run'];path='/sys/fs/cgroup/'+run['cgroupName'];group=None;members=[];listeners=[]
if os.path.lexists(path):
 info=os.lstat(path);assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
 group={'device':str(info.st_dev),'inode':str(info.st_ino)}
 assert group['device']==run['cgroupDevice'] and group['inode']==run['cgroupInode']
 for file in glob.glob('/proc/[0-9]*/cgroup'):
  try:membership=read(file,4096).decode().strip()
  except (FileNotFoundError,ProcessLookupError):continue
  if membership=='0::/'+run['cgroupName'] or membership.startswith('0::/'+run['cgroupName']+'/'):
   value=process(int(file.split('/')[2]))
   if value:members.append(value)
 for member in members:
  try:rows=read('/proc/'+str(member['pid'])+'/net/tcp',1048576).decode().splitlines()[1:]
  except (FileNotFoundError,ProcessLookupError):continue
  for row in rows:
   fields=row.split()
   if len(fields)>9 and fields[3]=='0A' and fields[9] in member['socketInodes'] and int(fields[1].split(':')[1],16)==r['port']:
    listeners.append({'address':fields[1],'process':member})
children=[]
for child in r.get('children',[]):
 value=process(child['pid']);children.append({'pid':child['pid'],'ticks':child['ticks'],'sameProcessAlive':bool(value and value['ticks']==child['ticks'])})
try:owner=json.loads(read('/run/sakura-browser-ide/'+r['projectId']+'/owner.json'))
except FileNotFoundError:owner=None
print(json.dumps({'bootId':boot,'group':group,'members':members,'listeners':listeners,'children':children,'owner':owner}))
`;

// Only the fixed native argv and original kernel identity enter root argv.
// A test descendant's Python body/environment remain in the native stdin frame.
const seedRunner = String.raw`import json,os,stat
header=b''
while not header.endswith(b'\n'):
 assert len(header)<16384,'test native metadata exceeded bound'
 byte=os.read(0,1);assert byte,'test native metadata truncated'
 header+=byte
r=json.loads(header)
assert open('/proc/sys/kernel/random/boot_id').read().strip()==r['run']['bootId']
path='/sys/fs/cgroup/'+r['run']['cgroupName']
fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
try:
 info=os.fstat(fd)
 assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
 assert str(info.st_dev)==r['run']['cgroupDevice'] and str(info.st_ino)==r['run']['cgroupInode']
 membership=os.open('cgroup.procs',os.O_WRONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
 try:os.write(membership,str(os.getpid()).encode())
 finally:os.close(membership)
finally:os.close(fd)
assert open('/proc/self/cgroup').read().strip()=='0::/'+r['run']['cgroupName']
os.execve('/bin/sh',['/bin/sh','-c',r['command']],{'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/','LANG':'C','LC_ALL':'C'})
`;

// Metadata uses unbuffered byte reads so execve leaves every binary frame byte
// on the original stdin descriptor for the UID launcher.
const childProgram = String.raw`import json,os,subprocess,time
child=subprocess.Popen(['/usr/bin/python3','-I','-S','-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(900)'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
time.sleep(.1)
fields=open('/proc/'+str(child.pid)+'/stat').read().rsplit(') ',1)[1].split()
status=dict(row.split(':',1) for row in open('/proc/self/status') if ':' in row)
value={'uid':os.getuid(),'euid':os.geteuid(),'gid':os.getgid(),'groups':os.getgroups(),'home':os.environ['HOME'],'cwd':os.getcwd(),
 'marker':os.environ.get('SAKURA_BROWSER_IDE_SMOKE'),'scope':open('/proc/self/cgroup').read().strip(),
 'networkDevice':str(os.stat('/proc/self/ns/net').st_dev),'networkInode':str(os.stat('/proc/self/ns/net').st_ino),
 'caps':{k:status[k].strip() for k in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs')},
 'child':{'pid':child.pid,'ticks':fields[19],'session':os.getsid(child.pid)}}
print(json.dumps(value))
`;

try {
  const vm = await machines.create({ name: 'browser-ide-smoke', distro: 'debian',
    memoryMiB: 3072, cpus: 2, diskGiB: 8, accelerator: 'auto' });
  await machines.start(vm.id);
  const deadline = Date.now() + 300_000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(300);
  }
  const observe = async (request: object) => {
    const result = await machines.execInput(vm.id,
      'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' + quote(observer),
      Buffer.from(JSON.stringify(request)), 30000);
    assert.equal(result.code, 0, result.stderr); return JSON.parse(result.stdout);
  };
  const cachedArchive = process.env.SAKURA_BROWSER_IDE_ARCHIVE;
  if (cachedArchive) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(resolve(cachedArchive))) hash.update(chunk);
    assert.equal(hash.digest('hex'), browserIdePackage.sha256, 'local IDE fixture has the wrong checksum');
    const cacheDirectory = browserIdePackage.cachePath.slice(0, browserIdePackage.cachePath.lastIndexOf('/'));
    const created = await machines.exec(vm.id, `mkdir -p ${quote(cacheDirectory)}`, 10000);
    assert.equal(created.code, 0, created.stderr);
    const damaged = await machines.exec(vm.id,
      `printf 'invalid cached release' > ${quote(browserIdePackage.cachePath)}`, 10000);
    assert.equal(damaged.code, 0, damaged.stderr);
    await assert.rejects(ide.run(vm.id, { mode: 'install' }, signal, () => {}), /checksum|FAILED/);
    assert.equal((await ide.view(vm.id)).installed, false, 'a damaged cache must not install executable content');
    await machines.sftp(vm.id, (sftp) => new Promise<void>((resolveCopy, reject) => {
      sftp.fastPut(resolve(cachedArchive), browserIdePackage.cachePath,
        (error) => error ? reject(error) : resolveCopy());
    }));
  }
  await workspaces.save(vm.id, { directory: projectDirectory,
    networkIsolation: isolated ? 'private' : 'host', environment: { SAKURA_BROWSER_IDE_SMOKE: marker } });
  const prepared = await machines.exec(vm.id, 'mkdir -p ' + quote(projectDirectory), 10000);
  assert.equal(prepared.code, 0, prepared.stderr);
  const original = await machines.exec(vm.id, 'stat -c %u ' + quote(projectDirectory), 10000);
  assert.equal(original.code, 0, original.stderr); assert.equal(original.stdout.trim(), '0');
  const migrations = new ProjectDirectoryMigrations(machines, workspaces);
  const preview = await migrations.preview(vm.id); assert.ok(preview.plan);
  assert.equal(preview.plan.proposal.directory, projectDirectory);
  const applied = await migrations.apply(vm.id, { action: 'apply', version: 1,
    planId: preview.plan.proposal.planId, sha256: preview.plan.sha256, reviewed: true });
  assert.equal(applied.plan?.state, 'applied'); assert.ok(applied.plan?.activatedIdentity);
  const identity = applied.plan.activatedIdentity;
  assert.equal(identity.projectId, 'default'); assert.notEqual(identity.uid, 0);
  assert.equal(identity.gid, identity.uid); assert.notEqual(identity.home, '/root');
  assert.equal(identity.home, '/var/lib/sakura-project-homes/' + identity.identityId);
  const project = await workspaces.resolvedConfig(vm.id);
  assert.deepEqual(await scopes.identity(vm.id, project), identity);

  const hostPort = await freePort();
  const result = await ide.run(vm.id, { mode: 'start', guestPort: 8080,
    hostPort, ttlMinutes: checkTerminal ? 3 : 1 }, signal, (line) => process.stdout.write(line));
  assert.equal(result.session?.status, 'running');
  const savedSession = async () => {
    const store = JSON.parse(await readFile(join(directory, 'browser-ide.json'), 'utf8'));
    const session = browserIdeSessionSchema.parse(store.sessions.find((row: { vmId: string; projectId: string }) =>
      row.vmId === vm.id && row.projectId === 'default'));
    assert.ok(session.execution?.run);
    return { ...session, execution: { ...session.execution, run: session.execution.run } };
  };
  const session = await savedSession(), execution = session.execution;
  assert.equal(session.status, 'running'); assert.equal(session.createdForward, false);
  assert.deepEqual(execution.identity, identity); assert.equal(execution.record.phase, 'running');
  assert.equal(execution.run.mode, 'inherit-current'); assert.equal(execution.run.phase, 'active');
  assert.equal(execution.run.cgroupName, 'sakura-service-' + execution.record.runId);
  assert.equal(execution.run.cgroupInode, execution.record.inode);
  const scope = new ProjectBrowserIdeScope(machines, vm.id, project, session.expiresAt);
  assert.deepEqual(projectBrowserIdeRecordSchema.parse(JSON.parse(await readFile(scope.receipt(), 'utf8'))), execution.record);
  assert.deepEqual((await scope.status(signal, execution.sha256)).record, execution.record);
  const journalEntry = async () => {
    const journal = JSON.parse(await readFile(join(vmDir(vm.id), 'project-identities', 'default.json'), 'utf8'));
    assert.deepEqual(projectIdentitySchema.parse(journal.identity), identity);
    const entry = journal.runs.find((row: { runId: string }) => row.runId === execution.run.runId);
    assert.ok(entry); assert.equal(entry.owner.kind, 'service');
    assert.equal(entry.owner.runId, execution.record.runId); assert.equal(entry.owner.bootId, execution.record.bootId);
    assert.equal(entry.sha256, execution.sha256); assert.deepEqual(projectIdentitySchema.parse(entry.identity), identity);
    return { ...entry, run: projectIdentityRunSchema.parse(entry.run) };
  };
  assert.deepEqual((await journalEntry()).run, execution.run);
  assert.deepEqual(await identities.runReadonly(vm.id, identity, execution.run.runId), execution.run);
  assert.equal(await scopes.readonlyActive(vm.id, 'default', execution.run.runId), true);
  assert.equal(machines.get(vm.id).forwards.length, 0, 'both network modes must own only a loopback SSH bridge');
  const checkCredentials = (value: any) => {
    assert.deepEqual(value.uid, [identity.uid, identity.uid, identity.uid, identity.uid]);
    assert.deepEqual(value.gid, [identity.gid, identity.gid, identity.gid, identity.gid]);
    assert.deepEqual(value.groups, []); assert.equal(value.home, identity.home); assert.equal(value.marker, marker);
    assert.equal(value.scope, '0::/' + execution.run.cgroupName);
    assert.equal(value.networkDevice, execution.run.networkDevice); assert.equal(value.networkInode, execution.run.networkInode);
    for (const name of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.equal(BigInt('0x' + value.caps[name]), 0n);
    assert.equal(value.caps.NoNewPrivs, '1');
  };
  const children: { pid: number; ticks: string }[] = [];
  const domain = () => observe({ operation: 'domain', run: execution.run, projectId: 'default', port: session.guestPort,
    password: session.password, children });
  const runtime = await domain();
  assert.equal(runtime.bootId, execution.run.bootId); assert.deepEqual(runtime.owner, execution.record);
  assert.ok(runtime.listeners.length > 0, 'must observe a real socket owned by the original domain');
  for (const listener of runtime.listeners) {
    assert.equal(listener.address, '0100007F:' + session.guestPort.toString(16).toUpperCase().padStart(4, '0'));
    checkCredentials(listener.process); assert.match(listener.process.command, /code-server/);
  }
  assert.ok(runtime.listeners.some((value: any) => value.process.passwordMatches));
  for (const member of runtime.members.filter((value: any) => value.uid[0] === 0)) {
    assert.equal(member.command.includes(session.password), false); assert.equal(member.command.includes(marker), false);
  }
  const plan = identities.input(identity, execution.run,
    { command: '/usr/bin/python3 -I -S -c ' + quote(childProgram), environment: project.environment });
  const seeded = await machines.execInput(vm.id,
    'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' + quote(seedRunner),
    Buffer.concat([Buffer.from(JSON.stringify({ run: execution.run, command: plan.command }) + '\n'), plan.input]), 30000);
  assert.equal(seeded.code, 0, seeded.stderr);
  const detached = JSON.parse(seeded.stdout); checkCredentials({ ...detached, uid: [detached.uid, detached.uid, detached.uid, detached.uid],
    gid: [detached.gid, detached.gid, detached.gid, detached.gid] });
  assert.equal(detached.euid, identity.uid); assert.equal(detached.cwd, projectDirectory);
  assert.equal(detached.child.session, detached.child.pid);
  children.push(detached.child);
  assert.ok((await domain()).children.every((value: any) => value.sameProcessAlive));

  const link = await ide.link(vm.id);
  assert.equal(link.url, `http://127.0.0.1:${hostPort}/`);
  assert.match(link.password, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(await ide.view(vm.id)).includes(link.password), false);
  const anonymous = await fetch(link.url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  await anonymous.body?.cancel(); assert.match(anonymous.headers.get('location') || '', /\/login/);
  const invalid = await fetch(link.url + 'login', { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: 'incorrect-password' }),
    signal: AbortSignal.timeout(10000) });
  await invalid.body?.cancel(); assert.equal(invalid.status, 200);
  const authenticated = await fetch(link.url + 'login', { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: link.password }),
    signal: AbortSignal.timeout(10000) });
  await authenticated.body?.cancel(); assert.ok(authenticated.status >= 300 && authenticated.status < 400);
  const cookie = authenticated.headers.get('set-cookie'); assert.ok(cookie);
  const opened = await fetch(link.url, { redirect: 'manual', headers: { cookie: cookie.split(';')[0] }, signal: AbortSignal.timeout(10000) });
  await opened.body?.cancel(); assert.ok(!opened.headers.get('location')?.includes('/login'));
  const editor = await fetch(link.url, { headers: { cookie: cookie.split(';')[0] }, signal: AbortSignal.timeout(10000) });
  const html = await editor.text(); assert.equal(editor.status, 200);
  assert.match(editor.headers.get('content-type') || '', /text\/html/); assert.match(html, /<html/i); assert.ok(!editor.url.includes('/login'));
  if (isolated) {
    const namespace = await machines.exec(vm.id,
      'test "$(ip -n sk-default -o link show | wc -l)" -eq 1 && ' +
      'test -z "$(ip -n sk-default -o -4 route show)" && test -z "$(ip -n sk-default -o -6 route show)" && ' +
      'test -n "$(ip netns pids sk-default)" && ip netns exec sk-default readlink /proc/self/ns/net', 10000);
    assert.equal(namespace.code, 0, namespace.stderr); assert.equal(namespace.stdout.trim(), 'net:[' + execution.run.networkInode + ']');
  }
  if (checkTerminal) {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ headless: true });
    let page: import('@playwright/test').Page | undefined;
    try {
      const context = await browser.newContext(), authCookie = cookie.split(';')[0], separator = authCookie.indexOf('=');
      await context.addCookies([{ name: authCookie.slice(0, separator), value: authCookie.slice(separator + 1), url: link.url }]);
      page = await context.newPage(); let sent = 0, received = 0;
      page.on('websocket', socket => { socket.on('framesent', () => sent++); socket.on('framereceived', () => received++); });
      await page.goto(link.url + '?folder=' + encodeURIComponent(projectDirectory));
      await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 45000 });
      const trust = page.getByRole('button', { name: /Yes, I trust the authors/ });
      if (await trust.isVisible()) await trust.click();
      const restricted = page.getByText('Restricted Mode', { exact: true });
      if (await restricted.isVisible()) {
        await restricted.click(); await page.getByRole('button', { name: 'Trust', exact: true }).click({ timeout: 15000 });
        await trust.click({ timeout: 5000 }).catch(() => {}); await restricted.waitFor({ state: 'hidden', timeout: 15000 });
      }
      await page.keyboard.press('Control+Shift+Backquote');
      await page.locator('.xterm-helper-textarea').first().focus({ timeout: 15000 });
      const reportPath = projectDirectory + '/terminal.json';
      const terminalProgram = childProgram.replace('print(json.dumps(value))',
        'fd=os.open(' + JSON.stringify(reportPath) + ',os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)\n' +
        'with os.fdopen(fd,"w") as stream:json.dump(value,stream);stream.flush();os.fsync(stream.fileno())');
      const encoded = "exec(__import__('base64').b64decode('" + Buffer.from(terminalProgram).toString('base64') + "'))";
      await page.keyboard.type('/usr/bin/python3 -I -S -c ' + quote(encoded)); await page.keyboard.press('Enter');
      const terminalDeadline = Date.now() + 20000;
      while ((await machines.exec(vm.id, 'test -f ' + quote(reportPath), 5000)).code !== 0) {
        assert.ok(Date.now() < terminalDeadline, 'IDE integrated terminal did not publish its UID report'); await delay(200);
      }
      const observed = await observe({ operation: 'report', path: reportPath, uid: identity.uid });
      const terminal = observed.report; checkCredentials({ ...terminal, uid: [terminal.uid, terminal.uid, terminal.uid, terminal.uid],
        gid: [terminal.gid, terminal.gid, terminal.gid, terminal.gid] });
      assert.equal(terminal.euid, identity.uid); assert.equal(terminal.cwd, projectDirectory);
      assert.equal(terminal.child.session, terminal.child.pid); children.push(terminal.child);
      assert.ok(sent > 0 && received > 0, 'real editor WebSocket traffic was not bidirectional');
      console.log('Browser IDE integrated terminal used the project UID/GID, home, original domain and namespace.');
    } catch (error) {
      if (page) {
        await page.screenshot({ path: resolve('.data', 'browser-ide-uid-terminal-' + marker + '.png'), fullPage: true }).catch(() => {});
        console.log('Terminal UI diagnostics:', JSON.stringify({ dialogs: await page.locator('.monaco-dialog-box').allTextContents(),
          palette: (await page.locator('.quick-input-widget').innerText().catch(() => '')).slice(0, 1000), terminals: await page.locator('.terminal').count() }));
      }
      throw error;
    } finally { await browser.close(); }
  }
  await ide.close(); ide = new BrowserIde(machines, workspaces); await ide.init();
  assert.deepEqual(await ide.link(vm.id), link); assert.equal((await ide.view(vm.id)).session?.status, 'running');
  assert.deepEqual((await savedSession()).execution, execution);
  assert.deepEqual(await identities.runReadonly(vm.id, identity, execution.run.runId), execution.run);
  console.log(`Real Debian/QEMU browser IDE authenticated through a ${isolated ? 'private' : 'host-network'} loopback SSH bridge ${hostPort}.`);

  // Closing the application removes its entrance but leaves the original guest
  // watchdog responsible for TTL cleanup of detached children and the full group.
  await ide.close(); await assert.rejects(fetch(link.url, { signal: AbortSignal.timeout(5000) }));
  await delay(Math.max(0, Date.parse(link.expiresAt) - Date.now()) + 2000);
  const cleanupDeadline = Date.now() + 45000; let expired = await domain();
  while (expired.group !== null || expired.owner?.phase !== 'stopped' || expired.children.some((value: any) => value.sameProcessAlive)) {
    assert.ok(Date.now() < cleanupDeadline, 'guest TTL watchdog did not remove the original full domain and detached children');
    await delay(500); expired = await domain();
  }
  assert.equal(expired.bootId, execution.run.bootId); assert.equal(expired.members.length, 0);
  assert.equal(expired.listeners.length, 0); assert.deepEqual(expired.owner, { ...execution.record, phase: 'stopped' });
  assert.equal((await journalEntry()).phase, 'active', 'guest watchdog must not invent a host/native close acknowledgement');
  assert.deepEqual(await savedSession(), session, 'application-close TTL cleanup must retain its original recovery metadata');
  const guestClosed = await machines.exec(vm.id,
    `${isolated ? 'ip netns exec sk-default ' : ''}curl -fsS --max-time 2 http://127.0.0.1:8080/healthz >/dev/null`, 5000);
  assert.notEqual(guestClosed.code, 0, 'code-server still accepts guest connections after full-domain expiry');
  ide = new BrowserIde(machines, workspaces); await ide.init();
  await assert.rejects(() => ide.link(vm.id), /原账号|过期|未就绪/);
  const retirementDeadline = Date.now() + 60000;
  while ((await journalEntry()).phase !== 'closed') {
    assert.ok(Date.now() < retirementDeadline, 'reload did not retire the original native ticket after full domain stop'); await delay(500);
  }
  const closedRun: ProjectIdentityRun = { ...execution.run, phase: 'closed' };
  assert.deepEqual((await journalEntry()).run, closedRun);
  assert.deepEqual(await identities.runReadonly(vm.id, identity, execution.run.runId), closedRun);
  assert.equal(await scopes.readonlyActive(vm.id, 'default', execution.run.runId), false);
  const removalDeadline = Date.now() + 10000;
  while (JSON.parse(await readFile(join(directory, 'browser-ide.json'), 'utf8')).sessions.length) {
    assert.ok(Date.now() < removalDeadline, 'BrowserIde retained a completed stop record'); await delay(100);
  }
  assert.equal(machines.get(vm.id).forwards.length, 0);
  await assert.rejects(fetch(link.url, { signal: AbortSignal.timeout(5000) }));
  console.log('Browser IDE TTL removed the original full cgroup and all pinned descendants; reload retired the complete original ticket and loopback entrance.');
} finally {
  await ide.close(); await workspaces.close(); await machines.close();
  assert.equal(await realpath(directory), resolve(directory));
  assert.equal(dirname(directory), await realpath(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-browser-ide-smoke-'));
  assert.equal(machines.live.size, 0, 'Owned temporary VM must close before removing its data');
  await rm(directory, { recursive: true, force: true });
}
