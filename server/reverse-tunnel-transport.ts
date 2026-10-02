import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { ClientChannel } from 'ssh2';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError } from './model.ts';
import { quote } from './files.ts';
import { projectIdentitySchema, projectIdentityRunSchema, type ProjectIdentity, type ProjectIdentityRun } from './project-identity.ts';

export const reverseTunnelListenerSchema = z.object({ port: z.number().int().min(1024).max(65535),
  pid: z.number().int().min(2), startTicks: z.string().regex(/^[1-9][0-9]*$/), socketInode: z.string().regex(/^[1-9][0-9]*$/) }).strict();
export type ReverseTunnelListener = z.infer<typeof reverseTunnelListenerSchema>;
export type ReverseTunnelBridge = { identity: ProjectIdentity; run: ProjectIdentityRun; listener: ReverseTunnelListener; token: string };

/** Only this UID broker connects to the requested project destination. */
export function reverseTunnelBrokerCommand(port: number, token: string, durationSeconds: number) {
  z.number().int().min(1).max(65535).parse(port); z.string().regex(/^[a-f0-9]{64}$/).parse(token);
  z.number().int().min(10).max(600).parse(durationSeconds);
  const source = `import socket,threading,secrets,time
token=bytes.fromhex(${JSON.stringify(token)})
destination=${port}
until=time.monotonic()+${durationSeconds + 120}
server=socket.socket();server.bind(('127.0.0.1',0));server.listen(4);server.settimeout(.5)
active=set();lock=threading.Lock()
def serve(conn):
 backend=None
 try:
  conn.settimeout(5);received=b''
  while len(received)<32:
   part=conn.recv(32-len(received))
   if not part:return
   received+=part
  if not secrets.compare_digest(received,token):return
  backend=socket.create_connection(('127.0.0.1',destination),5)
  conn.sendall(b'SKRTOK01');conn.settimeout(None);backend.settimeout(None)
  def upstream():
   try:
    while True:
     data=conn.recv(16384)
     if not data:break
     backend.sendall(data)
   except OSError:pass
   finally:
    try:backend.shutdown(socket.SHUT_WR)
    except OSError:pass
  threading.Thread(target=upstream,daemon=True).start()
  while True:
   data=backend.recv(16384)
   if not data:break
   conn.sendall(data)
 except OSError:pass
 finally:
  if backend is not None:backend.close()
  conn.close()
  with lock:active.discard(conn)
try:
 while time.monotonic()<until:
  try:conn,_=server.accept()
  except socket.timeout:continue
  with lock:
   if len(active)>=4:conn.close();continue
   active.add(conn)
  threading.Thread(target=serve,args=(conn,),daemon=True).start()
finally:
 server.close()
 with lock:
  for conn in active:
   try:conn.shutdown(socket.SHUT_RDWR)
   except OSError:pass
   conn.close()
`;
  return `exec /usr/bin/python3 -I -S -u -c ${quote(source)}`;
}

// Root reads only kernel ownership and enters the original network descriptor.
// No project file, interpreter path, environment or command is loaded by root.
const ownership = `
def refuse():raise ValueError('original reverse tunnel ownership changed')
def read(parent,name,limit):
 descriptor=os.open(name,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
 try:
  data=b''
  while len(data)<=limit:
   part=os.read(descriptor,min(4096,limit+1-len(data)))
   if not part:return data
   data+=part
  refuse()
 finally:os.close(descriptor)
def verify_group():
 if open('/proc/sys/kernel/random/boot_id').read().strip()!=request['bootId']:refuse()
 if not any(row.split()[3]=='/' and row.split()[4]=='/sys/fs/cgroup' and ' - cgroup2 ' in row for row in open('/proc/self/mountinfo')):refuse()
 info=os.lstat('/sys/fs/cgroup/'+request['cgroupName'])
 if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022 or str(info.st_dev)!=request['cgroupDevice'] or str(info.st_ino)!=request['cgroupInode']:refuse()
def network_fd():
 path='/run/netns/'+request['namespace'] if request['namespace'] else '/proc/1/ns/net'
 if request['namespace']:
  for parent in ['/run','/run/netns']:
   info=os.lstat(parent)
   if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:refuse()
 descriptor=os.open(path,os.O_RDONLY|os.O_CLOEXEC)
 info=os.fstat(descriptor)
 if info.st_uid!=0 or fcntl.ioctl(descriptor,0xb703)!=0x40000000 or str(info.st_dev)!=request['networkDevice'] or str(info.st_ino)!=request['networkInode']:os.close(descriptor);refuse()
 return descriptor
def listeners():
 verify_group();found=[];paths=glob.glob('/proc/[0-9]*')
 if len(paths)>32768:refuse()
 for path in paths:
  process=None;net=None;files=None
  try:
   process=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
   membership=read(process,'cgroup',4096).decode().strip()
   if membership!='0::/'+request['cgroupName'] and not membership.startswith('0::/'+request['cgroupName']+'/'):continue
   status=dict(line.split(':',1) for line in read(process,'status',65536).decode().splitlines() if ':' in line)
   if status.get('Uid','').split()!=[str(request['uid'])]*4 or status.get('Gid','').split()!=[str(request['gid'])]*4:continue
   before=read(process,'stat',4096).rsplit(b')',1)[1].split()
   if len(before)<20 or before[0] in [b'Z',b'X',b'x']:continue
   net=os.open('ns/net',os.O_RDONLY|os.O_CLOEXEC,dir_fd=process);info=os.fstat(net)
   if str(info.st_dev)!=request['networkDevice'] or str(info.st_ino)!=request['networkInode'] or fcntl.ioctl(net,0xb703)!=0x40000000:continue
   files=os.open('fd',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=process);sockets=set()
   for name in os.listdir(files):
    try:sockets.add(os.readlink(name,dir_fd=files))
    except (FileNotFoundError,ProcessLookupError):pass
   matches=[]
   for row in read(process,'net/tcp',1048576).decode().splitlines()[1:]:
    parts=row.split()
    if len(parts)>9 and parts[1].startswith('0100007F:') and parts[3]=='0A' and 'socket:['+parts[9]+']' in sockets:
     port=int(parts[1].split(':')[1],16)
     if port>=1024:matches.append({'port':port,'pid':int(path.rsplit('/',1)[1]),'startTicks':before[19].decode(),'socketInode':parts[9]})
   after=read(process,'stat',4096).rsplit(b')',1)[1].split()
   if before[19]==after[19] and after[0] not in [b'Z',b'X',b'x'] and membership==read(process,'cgroup',4096).decode().strip():found.extend(matches)
  except (FileNotFoundError,ProcessLookupError):pass
  finally:
   for descriptor in [files,net,process]:
    if descriptor is not None:os.close(descriptor)
 verify_group()
 return found
`;
function request(identity: ProjectIdentity, run: ProjectIdentityRun) {
  identity = projectIdentitySchema.parse(identity); run = projectIdentityRunSchema.parse(run);
  if (identity.phase !== 'active' || run.phase !== 'active' || run.mode !== 'inherit-current' ||
      identity.projectId !== run.projectId || identity.identityId !== run.identityId || identity.registryId !== run.registryId ||
      identity.revision !== run.revision || run.cgroupName !== 'sakura-service-' + run.runId ||
      run.namespace !== (identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : ''))
    throw new AppError('临时隧道完整账号票据不符', 409, 'SERVICE_SCOPE_CHANGED');
  return { bootId: run.bootId, cgroupName: run.cgroupName, cgroupDevice: run.cgroupDevice, cgroupInode: run.cgroupInode,
    networkDevice: run.networkDevice, networkInode: run.networkInode, namespace: run.namespace, uid: identity.uid, gid: identity.gid };
}
export function reverseTunnelListenerCommand(identity: ProjectIdentity, run: ProjectIdentityRun) {
  const source = 'import glob,json,os,stat,fcntl\nrequest=' + JSON.stringify(request(identity, run)) + ownership +
    '\nnetwork=network_fd();os.close(network)\nfound=listeners()\n' +
    "if len(found)>1:refuse()\nprint(json.dumps({'listener':found[0] if found else None}))\n";
  return 'exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C ' +
    '/usr/bin/python3 -I -S -c ' + quote(source);
}

const adapterSource = `import glob,json,os,stat,fcntl,socket,threading,struct,subprocess,ctypes
def exact(size):
 data=b''
 while len(data)<size:
  part=os.read(0,size-len(data))
  if not part:raise ValueError('truncated administrator bridge input')
  data+=part
 return data
header=exact(12)
if header[:8]!=b'SKRTCP01':raise ValueError('bridge frame header')
size=struct.unpack('<I',header[8:])[0]
if not 1<=size<=8192:raise ValueError('bridge frame bound')
request=json.loads(exact(size))
expected=request.pop('listener');token=request.pop('token')
if not isinstance(token,str) or len(token)!=64 or any(ch not in '0123456789abcdef' for ch in token):raise ValueError('bridge token')
` + ownership + `
if listeners()!=[expected]:refuse()
network=network_fd()
try:
 if ctypes.CDLL(None,use_errno=True).setns(network,0x40000000)!=0:refuse()
finally:os.close(network)
if request['namespace']:
 if [name for _,name in socket.if_nameindex()]!=['lo']:refuse()
 ip=next((path for path in ['/usr/sbin/ip','/sbin/ip','/usr/bin/ip'] if os.path.isfile(path)),None)
 if ip is None:refuse()
 for family in ['-4','-6']:
  result=subprocess.run([ip,'-o',family,'route','show'],capture_output=True,timeout=3)
  if result.returncode or result.stdout.strip():refuse()
sock=socket.create_connection(('127.0.0.1',expected['port']),5)
try:
 if listeners()!=[expected]:refuse()
 sock.sendall(bytes.fromhex(token));ack=b''
 while len(ack)<8:
  part=sock.recv(8-len(ack))
  if not part:refuse()
  ack+=part
 if ack!=b'SKRTOK01':refuse()
 sock.settimeout(None)
 def upstream():
  try:
   while True:
    data=os.read(0,16384)
    if not data:break
    sock.sendall(data)
  except OSError:pass
  finally:
   try:sock.shutdown(socket.SHUT_WR)
   except OSError:pass
 threading.Thread(target=upstream,daemon=True).start()
 while True:
  data=sock.recv(16384)
  if not data:break
  offset=0
  while offset<len(data):offset+=os.write(1,data[offset:])
finally:sock.close()
`;
export const reverseTunnelAdapterCommand = 'exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ ' +
  'LANG=C LC_ALL=C /bin/sh -ec ' + quote('cd /\nexec /usr/bin/python3 -I -S -u -c ' + quote(adapterSource));
export function reverseTunnelAdapterInput(proof: ReverseTunnelBridge) {
  const listener = reverseTunnelListenerSchema.parse(proof.listener), token = z.string().regex(/^[a-f0-9]{64}$/).parse(proof.token);
  const metadata = Buffer.from(JSON.stringify({ ...request(proof.identity, proof.run), listener, token }));
  if (metadata.length > 8192) throw new AppError('管理员 socket 元数据超过边界', 413, 'GUEST_INPUT_INVALID');
  const frame = Buffer.alloc(12 + metadata.length); frame.write('SKRTCP01'); frame.writeUInt32LE(metadata.length, 8); metadata.copy(frame, 12);
  return { input: frame, sha256: createHash('sha256').update(frame).digest('hex') };
}
export async function openReverseTunnelBridge(machines: Machines, id: string, proof: ReverseTunnelBridge,
  expectedLive: unknown, signal: AbortSignal, validate: () => Promise<void>): Promise<Duplex> {
  const input = reverseTunnelAdapterInput(proof).input;
  const current = () => { signal.throwIfAborted(); if (machines.live.get(id) !== expectedLive || machines.state(id) !== 'running')
    throw new AppError('原临时隧道客户机身份已改变', 409, 'SERVICE_SCOPE_CHANGED'); };
  current(); await validate(); current();
  const client = await machines.connect(id, 10000, signal); let channel: ClientChannel | undefined;
  try {
    current(); await validate(); current();
    const stream = await new Promise<ClientChannel>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, channel?: ClientChannel) => {
        if (settled) { channel?.destroy(); return; } settled = true; clearTimeout(timer);
        signal.removeEventListener('abort', cancelled); client.off('close', closed); client.off('error', failed);
        error ? reject(error) : resolve(channel!);
      };
      const cancelled = () => finish(signal.reason instanceof Error ? signal.reason : new AppError('临时隧道连接已取消', 409)),
        closed = () => finish(new Error('SSH connection closed')), failed = (error: Error) => finish(error);
      const timer = setTimeout(() => finish(new AppError('临时隧道连接超时', 504)), 10000); timer.unref();
      signal.addEventListener('abort', cancelled, { once: true }); client.once('close', closed); client.once('error', failed);
      if (signal.aborted) return cancelled();
      client.exec(reverseTunnelAdapterCommand, (error, channel) => finish(error || undefined, channel));
    });
    channel = stream;
    stream.stderr.resume(); stream.stderr.on('error', () => stream.destroy());
    const abort = () => { stream.destroy(); client.destroy(); };
    const disconnected = () => stream.destroy();
    signal.addEventListener('abort', abort, { once: true });
    client.once('close', disconnected);
    stream.once('close', () => { signal.removeEventListener('abort', abort); client.off('close', disconnected); client.end(); });
    stream.on('error', () => stream.destroy()); client.on('error', () => stream.destroy());
    current(); await validate(); current();
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error | null) => { clearTimeout(timer); stream.off('close', closed); stream.off('error', failed);
        error ? reject(error) : resolve(); };
      const closed = () => finish(signal.reason instanceof Error ? signal.reason : new Error('SSH bridge closed before metadata delivery'));
      const failed = (error: Error) => finish(error);
      const timer = setTimeout(() => finish(new AppError('临时隧道元数据传输超时', 504)), 10000); timer.unref();
      stream.once('close', closed); stream.once('error', failed);
      if (stream.destroyed) { closed(); return; }
      stream.write(input, error => finish(error));
    }); current();
    return stream;
  } catch (error) { channel?.destroy(); client.destroy(); throw error; }
}
