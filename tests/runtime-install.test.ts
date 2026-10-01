import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { runtimeInstallCommand, runtimeInstallSetup, parseRuntimeInstall, parseRuntimeInstallRecovery } from '../server/runtime-install.ts';

const installId = randomUUID(), bootId = randomUUID(), runId = randomUUID();
const request = { operation: 'verify' as const, tool: 'node' as const, version: '22.12.0', architecture: 'x86_64' as const };
const ready = { version: 1, tool: 'node', architecture: 'x86_64', requestedVersion: request.version,
  phase: 'ready', installId, directoryDevice: '1', directoryInode: '9', executableDevice: '1',
  executableInode: '10', executableSha256: 'a'.repeat(64) };
const result = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });

test('installation and recovery replies require complete matching identities and strict envelopes', () => {
  assert.equal(parseRuntimeInstall(result({ version: 1, ok: true, result: ready }),
    { tool: 'node', version: request.version, architecture: 'x86_64', phase: 'ready' }).installId, installId);
  assert.equal(parseRuntimeInstallRecovery(result({ version: 1, ok: true, result: null }), request), null);
  for (const value of [{ version: 1, ok: true, result: ready, ignored: true },
    { version: 1, ok: true, result: { ...ready, phase: 'prepared' } },
    { version: 1, ok: true, result: { ...ready, architecture: 'aarch64' } },
    { version: 1, ok: true, result: { ...ready, requestedVersion: '22.13.0' } },
    { version: 1, ok: true, result: { ...ready, tool: 'python' } }])
    assert.throws(() => parseRuntimeInstallRecovery(result(value), request));
  assert.throws(() => parseRuntimeInstall({ ...result({ version: 1, ok: true, result: ready }), code: 1 },
    { tool: 'node', version: request.version, phase: 'ready' }));
});

test('administrator installation requests validate architecture, boot, identifiers and credential-free network', () => {
  assert.match(runtimeInstallCommand({ ...request, architecture: 'aarch64' }), /\\"architecture\\":\\"aarch64\\"/);
  assert.throws(() => runtimeInstallCommand({ ...request, architecture: 'arm64' as any }));
  assert.throws(() => runtimeInstallCommand({ ...request, operation: 'prepare', installId, runId }));
  assert.throws(() => runtimeInstallCommand({ ...request, operation: 'confirm', installId }));
  assert.throws(() => runtimeInstallCommand({ ...request, network: { PIP_INDEX_URL: 'https://registry.example/simple?token=secret' } }));
  assert.throws(() => runtimeInstallCommand({ ...request, network: { PIP_INDEX_URL: 'https://user:secret@registry.example/simple' } }));
  assert.throws(() => runtimeInstallCommand({ ...request, network: { LD_PRELOAD: '/project/lib.so' } }));
});

test('installer prerequisites supply relocatable shell tools under a fixed environment and directory', () => {
  const network = { HTTPS_PROXY: 'https://proxy.example:8443', NO_PROXY: 'localhost;$(echo unit-marker) ${PATH}' };
  const commands = ['alpine', undefined, 'debian', 'ubuntu'].map(distro => runtimeInstallSetup(distro, network));
  const parsed = spawnSync('python', ['-I', '-S', '-c',
    'import json,shlex,sys;print(json.dumps([shlex.split(value) for value in json.load(sys.stdin)]))'],
    { input: JSON.stringify(commands), encoding: 'utf8', timeout: 10_000 });
  assert.equal(parsed.status, 0, parsed.stderr || parsed.error?.message);
  const invocations = JSON.parse(parsed.stdout) as string[][];
  for (const args of invocations) {
    assert.deepEqual(args.slice(0, 6), ['/usr/bin/env', '-i', 'PATH=/usr/sbin:/usr/bin:/sbin:/bin', 'HOME=/root', 'LANG=C', 'LC_ALL=C']);
    assert.deepEqual(args.slice(6, -1), ['HTTPS_PROXY=' + network.HTTPS_PROXY, 'NO_PROXY=' + network.NO_PROXY,
      'DEBIAN_FRONTEND=noninteractive', '/bin/sh', '-eu', '-c']);
    assert.ok(args.at(-1)!.startsWith('cd /\n'));
    assert.equal(args.at(-1)!.includes('unit-marker'), false);
  }
  for (const args of invocations.slice(0, 2)) {
    const packages = args.at(-1)!.split('\n');
    assert.equal(packages.length, 2);
    assert.ok(packages[1].startsWith('/sbin/apk add --no-cache --timeout 30 '));
    // uv 0.10.11's relocatable pip launcher calls realpath -- "$0". The
    // Alpine BusyBox applet does not implement that option terminator.
    assert.ok(packages[1].split(' ').includes('coreutils'));
  }
  assert.throws(() => runtimeInstallSetup('alpine', { PATH: '/project/bin' }));
  assert.throws(() => runtimeInstallSetup('alpine', { HTTPS_PROXY: 'https://proxy.example?token=unit-secret' }));
});

// A deterministic filesystem model exercises the shipped controller's state
// transitions and pathname/metadata checks on Windows too. It is not evidence
// of Linux ownership, kernel cgroups or official artifact installation.
function controllerModel(scenario: string) {
  const command = runtimeInstallCommand({ ...request, installId, runId, bootId });
  const source = command.split("<<'SAKURA_RUNTIME_INSTALL'\n")[1]
    .replace('import errno,fcntl,hashlib,json,os,re,shutil,stat,subprocess,sys,uuid',
      'import errno,hashlib,json,os,re,shutil,stat,subprocess,sys,uuid')
    .split('\ntry:\n    DESTINATION=')[0];
  const program = String.raw`import copy,hashlib,json,posixpath,stat,sys,types
data=json.load(sys.stdin); namespace={}; exec(data['source'],namespace)
root=namespace['ROOT']; state=namespace['STATE']; cg=namespace['CGROUP']; req=namespace['REQUEST']
scenario=data['scenario']
if scenario.startswith('managed-'): req.update(tool='python',version='3.12.12')
destination=root+'/'+req['tool']+'-'+req['version']; receipt=state+'/'+req['tool']+'-'+req['version']+'.json'
stage=root+'/.install-'+req['installId']; group=cg+'/sakura-task-'+req['runId']
content=b'controlled-unit-artifact'; digest=hashlib.sha256(content).hexdigest()
files={}; links={}; descriptors={}; events=[]; next_fd=100; next_inode=1000; race_path=None
def entry(path,mode,inode,body=b''):
 files[path]=types.SimpleNamespace(st_mode=mode,st_uid=0,st_nlink=1,st_size=len(body),st_dev=1,st_ino=inode,st_mtime_ns=1,st_ctime_ns=1,body=body)
def directory(path,inode=2,mode=0o755): entry(path,stat.S_IFDIR|mode,inode)
for path in ['/','/opt',root,'/var','/var/lib','/var/lib/sakura',state,'/sys','/sys/fs',cg,group,stage,destination,destination+'/bin',destination+'/lib',destination+'/lib/npm',destination+'/lib/npm/bin']:
 directory(path,5 if path==group else 7 if path==stage else 9 if path==destination else 2,0o700 if path in (state,stage) else 0o755)
entry(state+'/lock',stat.S_IFREG|0o600,3)
entry(group+'/cgroup.events',stat.S_IFREG|0o644,6,b'populated 0\n')
entry(destination+'/bin/node',stat.S_IFREG|0o755,10,content)
entry(destination+'/lib/npm/bin/npm-cli.js',stat.S_IFREG|0o755,12,b'unit npm')
entry(destination+'/bin/npm',stat.S_IFLNK|0o777,13); links[destination+'/bin/npm']='../lib/npm/bin/npm-cli.js'
value={'version':1,'tool':req['tool'],'architecture':'x86_64','requestedVersion':req['version'],'phase':'prepared','installId':req['installId'],
 'scope':{'name':'sakura-task-'+req['runId'],'bootId':req['bootId'],'device':'1','inode':'5'},'stage':stage,
 'stageInfo':{'device':'1','inode':'7'},'managedPath':None,'managedInfo':None,
 'artifactInfo':{'device':'1','inode':'9'},'executableInfo':{'device':'1','inode':'10'},'executableSha256':digest}
managed=root+'/python-managed-'+req['installId']
old=root+'/python-downloads'
if req['tool']=='python':
 directory(old,60,0o700); entry(old+'/.lock',stat.S_IFREG|0o666,61)
 directory(managed,70,0o700); directory(managed+'/cpython-3.12.12',71)
 directory(managed+'/cpython-3.12.12/bin',72)
 entry(managed+'/.lock',stat.S_IFREG|0o644,73)
 entry(managed+'/cpython-3.12.12/bin/python3.12',stat.S_IFREG|0o755,10,content)
 entry(managed+'/cpython-3.12',stat.S_IFLNK|0o777,74); links[managed+'/cpython-3.12']='cpython-3.12.12'
 entry(destination+'/bin/python3',stat.S_IFLNK|0o777,75); links[destination+'/bin/python3']=managed+'/cpython-3.12/bin/python3.12'
 value.update(managedPath=managed,managedInfo={'device':'1','inode':'70'})
def store(item): entry(receipt,stat.S_IFREG|0o600,14,json.dumps(item).encode('utf-8'))
store(value)
def lstat(path):
 if path not in files: raise FileNotFoundError(path)
 return copy.copy(files[path])
def realpath(path):
 path=posixpath.normpath(path)
 for _ in range(32):
  parts=path.split('/'); current=''; resolved=False
  for index,part in enumerate(parts[1:],1):
   current+='/'+part
   if current in links:
    suffix='/'.join(parts[index+1:]); target=links[current]
    path=posixpath.normpath((target if target.startswith('/') else posixpath.dirname(current)+'/'+target)+('/'+suffix if suffix else ''))
    resolved=True; break
  if not resolved: return path
 raise OSError('link cycle')
def open_fd(path,flags,mode=0,dir_fd=None):
 global next_fd,race_path
 if dir_fd is not None: path=descriptors[dir_fd][0]+'/'+path
 if path==race_path: files[path].st_ino+=1; race_path=None
 if flags&0x100 and path in links: raise OSError('nofollow')
 if path not in files:
  if flags&0x40: entry(path,stat.S_IFREG|mode,90)
  else: raise FileNotFoundError(path)
 next_fd+=1; descriptors[next_fd]=[path,0]; return next_fd
def read_fd(fd,count):
 item=descriptors[fd]; body=files[item[0]].body; result=body[item[1]:item[1]+count]; item[1]+=len(result); return result
def unlink(path): del files[path]; links.pop(path,None); events.append(('unlink',path))
def mkdir(path,mode):
 global next_inode
 if path in files: raise FileExistsError(path)
 next_inode+=1; directory(path,next_inode,mode&~0o077); events.append(('mkdir',path))
def fchmod(fd,mode):
 path=descriptors[fd][0]; files[path].st_mode=stat.S_IFMT(files[path].st_mode)|mode; events.append(('chmod',path,mode))
def rmtree(path):
 events.append(('remove',path))
 for name in list(files):
  if name==path or name.startswith(path+'/'): del files[name]; links.pop(name,None)
def walk(path,followlinks=False,onerror=None):
 for name,item in list(files.items()):
  if name!=path and not name.startswith(path+'/'): continue
  if not stat.S_ISDIR(item.st_mode): continue
  directories=[]; regular=[]
  for candidate,child in files.items():
   if posixpath.dirname(candidate)!=name: continue
   (directories if stat.S_ISDIR(child.st_mode) else regular).append(posixpath.basename(candidate))
  yield name,directories,regular
fakeos=types.SimpleNamespace(getuid=lambda:0,geteuid=lambda:0,uname=lambda:types.SimpleNamespace(machine='x86_64'),
 lstat=lstat,path=types.SimpleNamespace(lexists=lambda path:path in files,realpath=realpath,isdir=lambda path:stat.S_ISDIR(lstat(realpath(path)).st_mode)),
 O_NOFOLLOW=0x100,O_NONBLOCK=0x200,O_RDWR=2,O_CREAT=0x40,O_RDONLY=0,O_DIRECTORY=0x1000,
 open=open_fd,read=read_fd,fstat=lambda fd:lstat(descriptors[fd][0]),close=lambda fd:descriptors.pop(fd,None),
 unlink=unlink,walk=walk,mkdir=mkdir,fchmod=fchmod,fsync=lambda fd:events.append(('fsync',descriptors[fd][0])),
 readlink=lambda path:links[path])
fakeos.path.normpath=posixpath.normpath; fakeos.path.dirname=posixpath.dirname
namespace.update(os=fakeos,fcntl=types.SimpleNamespace(LOCK_EX=1,LOCK_SH=2,LOCK_NB=4,flock=lambda fd,mode:events.append(('lock',mode))),
 shutil=types.SimpleNamespace(rmtree=rmtree),DESTINATION=destination,RECEIPT=receipt,
 boot=lambda:req['bootId'],cgroup_mount=lambda:None,sync=lambda path:None,
 durable=lambda path,item:(events.append(('publish',item['phase'])),store(item)),
 run=lambda *arguments:(_ for _ in ()).throw(AssertionError('read-only control must not execute a runtime')))
Refused=namespace['Refused']; main=namespace['main']
def refused(code,action=main):
 try: action()
 except Refused as error: assert error.code==code,(error.code,code)
 else: raise AssertionError('expected '+code)
if scenario=='prepared':
 refused('INSTALL_INCOMPLETE'); assert not any(item[0]=='publish' for item in events)
elif scenario=='confirm':
 req['operation']='confirm'; files[group+'/cgroup.events'].body=b'populated 1\n'
 refused('INSTALL_SCOPE_ACTIVE'); assert json.loads(files[receipt].body)['phase']=='prepared' and stage in files
 files[group+'/cgroup.events'].body=b'populated 0\n'
 answer=main(); assert answer['phase']=='ready' and stage not in files
 assert events.index(('remove',stage))<events.index(('publish','ready'))
 req['operation']='verify'; assert main()['phase']=='ready'
elif scenario=='identity':
 req['operation']='recover'; req['installId']='00000000-0000-4000-8000-000000000001'
 refused('INSTALL_ID_CHANGED'); assert stage in files and destination in files
 req['installId']=value['installId']; files[stage].st_ino+=1
 refused('CLEANUP_CHANGED'); assert stage in files
elif scenario=='recover':
 req['operation']='recover'; neighbor=root+'/neighbor'; directory(neighbor,77)
 assert main() is None and stage not in files and destination not in files and receipt not in files and neighbor in files
 assert main() is None and neighbor in files
elif scenario=='ready':
 value['phase']='ready'; store(value); assert main()['phase']=='ready'
 files[destination+'/bin/node'].body=b'changed-artifact'
 refused('ARTIFACT_CHANGED'); assert destination in files
elif scenario=='links':
 namespace['tree'](destination)
 links[destination+'/bin/npm']='/project/evil'; refused('ARTIFACT_LINK',lambda:namespace['tree'](destination))
elif scenario=='metadata':
 files[receipt].st_nlink=2; refused('RECEIPT_INVALID')
elif scenario=='architecture':
 req['architecture']='aarch64'; refused('INSTALL_ARCH'); assert not any(item[0]=='publish' for item in events)
elif scenario=='new-directory':
 new=root+'/new-parent'; created=namespace['created_directory'](new,0o755)
 assert stat.S_IMODE(files[new].st_mode)==0o755 and namespace['exact'](created,namespace['info'](files[new]))
 unknown=root+'/unknown-private'; directory(unknown,99,0o700); events.clear()
 assert stat.S_IMODE(namespace['safe'](unknown,create=True).st_mode)==0o700 and not events
 files[root].st_mode=stat.S_IFDIR|0o700; refused('PATH_ACCESS')
 assert stat.S_IMODE(files[root].st_mode)==0o700 and not any(item[0]=='chmod' for item in events)
elif scenario=='ancestor-access':
 files['/opt'].st_mode=stat.S_IFDIR|0o700; refused('PATH_ACCESS')
 assert stat.S_IMODE(files['/opt'].st_mode)==0o700 and not any(item[0]=='chmod' for item in events)
 files['/opt'].st_mode=stat.S_IFDIR|0o775; refused('PATH_OWNER')
 assert stat.S_IMODE(files['/opt'].st_mode)==0o775 and not any(item[0]=='chmod' for item in events)
elif scenario.startswith('normalize-'):
 artifact=stage+'/new-runtime'; directory(artifact,100,0o700); directory(artifact+'/bin',101,0o700)
 entry(artifact+'/.lock',stat.S_IFREG|0o666,102); entry(artifact+'/bin/node',stat.S_IFREG|0o700,103,content)
 expected={'device':'1','inode':'100'}
 action=lambda:namespace['normalized'](artifact,expected,stage,value['stageInfo'])
 if scenario=='normalize-permissions':
  action()
  assert stat.S_IMODE(files[artifact].st_mode)==0o755 and stat.S_IMODE(files[artifact+'/bin'].st_mode)==0o755
  assert stat.S_IMODE(files[artifact+'/.lock'].st_mode)==0o644 and stat.S_IMODE(files[artifact+'/bin/node'].st_mode)==0o755
  assert stat.S_IMODE(files[stage].st_mode)==0o700 and stat.S_IMODE(files[state].st_mode)==0o700
 elif scenario=='normalize-replaced':
  race_path=artifact+'/bin/node'; refused('ARTIFACT_CHANGED',action)
  assert not any(item[0]=='chmod' and item[1]==artifact+'/bin/node' for item in events)
 elif scenario=='normalize-owner':
  files[artifact+'/.lock'].st_uid=100000; refused('ARTIFACT_OWNER',action)
  assert not any(item[0]=='chmod' for item in events)
 elif scenario=='normalize-setid':
  files[artifact+'/bin/node'].st_mode=stat.S_IFREG|0o4755; refused('ARTIFACT_OWNER',action)
  assert not any(item[0]=='chmod' for item in events)
 elif scenario=='normalize-hardlink':
  files[artifact+'/.lock'].st_nlink=2; refused('ARTIFACT_LINK',action)
  assert not any(item[0]=='chmod' for item in events)
 elif scenario=='normalize-alias':
  directory('/tmp',105,0o1777); entry('/tmp/alias',stat.S_IFLNK|0o777,106); links['/tmp/alias']=artifact+'/bin/node'
  entry(artifact+'/alias',stat.S_IFLNK|0o777,107); links[artifact+'/alias']='/tmp/alias'
  refused('ARTIFACT_LINK',action); assert not any(item[0]=='chmod' for item in events)
 elif scenario=='normalize-unknown':
  files[destination+'/bin/node'].st_mode=stat.S_IFREG|0o666
  refused('ARTIFACT_CHANGED',lambda:namespace['normalized'](destination,value['artifactInfo'],stage,value['stageInfo']))
  assert stat.S_IMODE(files[destination+'/bin/node'].st_mode)==0o666 and not any(item[0]=='chmod' for item in events)
 else: raise AssertionError(scenario)
elif scenario=='managed-normalize':
 files[managed+'/.lock'].st_mode=stat.S_IFREG|0o666; files[managed+'/cpython-3.12.12/bin'].st_mode=stat.S_IFDIR|0o700
 namespace['normalized'](managed,value['managedInfo'],managed,value['managedInfo'],root_mode=0o700)
 assert stat.S_IMODE(files[managed].st_mode)==0o700 and stat.S_IMODE(files[managed+'/.lock'].st_mode)==0o644
 assert stat.S_IMODE(files[managed+'/cpython-3.12.12/bin'].st_mode)==0o755
 assert stat.S_IMODE(files[old+'/.lock'].st_mode)==0o666 and files[old].st_ino==60
elif scenario=='managed-confirm':
 req['operation']='confirm'; answer=main(); assert answer['phase']=='ready' and stage not in files and managed in files
 assert stat.S_IMODE(files[managed].st_mode)==0o755 and json.loads(files[receipt].body)['managedInfo']==value['managedInfo']
 assert events.index(('chmod',managed,0o755))<events.index(('publish','ready'))
 events.clear(); req['operation']='verify'; assert main()['phase']=='ready'
 assert not any(item[0] in ('chmod','publish','remove','unlink','mkdir') for item in events)
 assert stat.S_IMODE(files[old+'/.lock'].st_mode)==0o666
elif scenario=='managed-inode':
 req['operation']='confirm'; files[managed].st_ino+=1; refused('ARTIFACT_CHANGED')
 assert destination in files and stage in files and not any(item[0]=='chmod' for item in events)
elif scenario=='managed-external':
 req['operation']='confirm'; entry(old+'/old-python',stat.S_IFREG|0o755,80,content)
 links[destination+'/bin/python3']=old+'/old-python'; refused('ARTIFACT_LINK')
 assert destination in files and stage in files and not any(item[0]=='chmod' for item in events)
elif scenario=='managed-ready-mode':
 value['phase']='ready'; store(value); refused('ARTIFACT_MODE')
 assert stat.S_IMODE(files[managed].st_mode)==0o700 and not any(item[0]=='chmod' for item in events)
elif scenario=='managed-ready-recover':
 value['phase']='ready'; files[managed].st_mode=stat.S_IFDIR|0o755; store(value)
 req['operation']='recover'; assert main()['phase']=='ready' and managed in files and destination in files
 assert not any(item[0] in ('chmod','publish','remove','unlink') for item in events)
elif scenario=='managed-recover':
 req['operation']='recover'; files[managed].st_ino+=1; refused('CLEANUP_CHANGED')
 assert stage in files and destination in files and not any(item[0]=='remove' for item in events)
 files[managed].st_ino-=1; assert main() is None and stage not in files and destination not in files and managed not in files
 assert old in files and stat.S_IMODE(files[old+'/.lock'].st_mode)==0o666
elif scenario=='managed-cancel':
 rmtree(destination); events.clear()
 value.update(phase='building',artifactInfo=None,executableInfo=None,executableSha256=None); store(value)
 files[managed+'/.lock'].st_mode=stat.S_IFREG|0o666; req['operation']='recover'
 files[group+'/cgroup.events'].body=b'populated 1\n'; refused('INSTALL_SCOPE_ACTIVE')
 assert managed in files and stage in files and not any(item[0]=='remove' for item in events)
 files[group+'/cgroup.events'].body=b'populated 0\n'; assert main() is None
 assert managed not in files and stage not in files and old in files and stat.S_IMODE(files[old+'/.lock'].st_mode)==0o666
elif scenario=='managed-unknown':
 rmtree(destination); events.clear()
 value.update(phase='building',managedInfo=None,artifactInfo=None,executableInfo=None,executableSha256=None); store(value)
 req['operation']='recover'; refused('CLEANUP_CHANGED')
 assert managed in files and stage in files and not any(item[0]=='remove' for item in events)
else: raise AssertionError(scenario)
print('ok')
`;
  const executed = spawnSync('python', ['-I', '-S', '-c', program], {
    input: JSON.stringify({ source, scenario }), encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(executed.status, 0, executed.stderr || executed.error?.message);
  assert.equal(executed.stdout.trim(), 'ok');
}

for (const scenario of ['prepared', 'confirm', 'identity', 'recover', 'ready', 'links', 'metadata', 'architecture',
  'new-directory', 'ancestor-access', 'normalize-permissions', 'normalize-replaced', 'normalize-owner', 'normalize-setid',
  'normalize-hardlink', 'normalize-alias', 'normalize-unknown', 'managed-normalize', 'managed-confirm',
  'managed-inode', 'managed-external', 'managed-ready-mode', 'managed-ready-recover', 'managed-recover',
  'managed-cancel', 'managed-unknown'])
  test(`fixed installer controller model: ${scenario}`, () => controllerModel(scenario));
