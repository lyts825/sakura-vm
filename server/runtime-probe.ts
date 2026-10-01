import { z } from 'zod';
import { AppError } from './model.ts';

export const runtimeProbeTimeout = 15_000;
export const runtimeProbeOutputBytes = 4096;
const version = z.string().regex(/^\d{1,2}\.\d{1,3}\.\d{1,3}$/);
const declaration = z.string().regex(/^\d{1,2}(?:\.\d{1,3}){0,2}$/);
const actual = z.object({ node: z.union([version, z.literal('')]),
  python: z.union([version, z.literal('')]) }).strict();
const declared = z.object({ node: declaration.optional(), python: declaration.optional() }).strict();
export const runtimeProbeFailureCodes = [
  'DECLARATION_ACCESS', 'DECLARATION_FILE_TYPE', 'DECLARATION_LIMIT', 'DECLARATION_ENCODING',
  'DECLARATION_CHANGED', 'DECLARATION_IO', 'TOOL_ACCESS', 'TOOL_TIMEOUT', 'TOOL_LIMIT',
  'TOOL_ENCODING', 'TOOL_OUTPUT', 'TOOL_EXIT', 'TOOL_IO', 'BOOT_ID', 'PROBE_INTERNAL',
] as const;
const reply = z.discriminatedUnion('ok', [
  z.object({ version: z.literal(1), ok: z.literal(true), bootId: z.uuid(), declared, actual }).strict(),
  z.object({ version: z.literal(1), ok: z.literal(false), code: z.enum(runtimeProbeFailureCodes) }).strict(),
]);
export type RuntimeProbeSample = { bootId: string; declared: z.infer<typeof declared>; actual: z.infer<typeof actual> };
export function parseRuntimeProbe(result: { code: number; stdout: string; stderr: string }): RuntimeProbeSample {
  if (Buffer.byteLength(result.stdout) > runtimeProbeOutputBytes || result.stderr !== '')
    throw new AppError('运行时探测未返回完整、受限的版本回执', 502, 'RUNTIME_PROBE_REPLY');
  let value: z.infer<typeof reply>;
  try { value = reply.parse(JSON.parse(result.stdout)); }
  catch { throw new AppError('运行时探测回执无效', 502, 'RUNTIME_PROBE_REPLY'); }
  if (!value.ok) throw new AppError('运行时探测失败，请检查项目版本文件或可执行文件',
    409, 'RUNTIME_' + value.code);
  if (result.code !== 0) throw new AppError('运行时探测未完整结束', 502, 'RUNTIME_PROBE_REPLY');
  return { bootId: value.bootId, declared: value.declared, actual: value.actual };
}

// This fixed helper is transported inside the project identity payload. Python,
// declarations and version binaries all run after the native UID/cgroup drop.
// Raw program output never reaches SSH, logs or the host sample cache.
const helper = String.raw`import errno,json,os,re,selectors,stat,subprocess,time
class Refused(Exception):
    def __init__(self,code): self.code=code
def refuse(code): raise Refused(code)
def declaration(name):
    try: fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    except OSError as error:
        if error.errno==errno.ENOENT: return None
        if error.errno in (errno.ELOOP,errno.ENXIO,errno.ENODEV): refuse('DECLARATION_FILE_TYPE')
        if error.errno in (errno.EACCES,errno.EPERM): refuse('DECLARATION_ACCESS')
        refuse('DECLARATION_IO')
    try:
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode): refuse('DECLARATION_FILE_TYPE')
        if before.st_size>4096: refuse('DECLARATION_LIMIT')
        data=os.read(fd,4097)
        after=os.fstat(fd)
        if len(data)>4096: refuse('DECLARATION_LIMIT')
        if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns): refuse('DECLARATION_CHANGED')
        if len(data)!=before.st_size: refuse('DECLARATION_CHANGED')
        if b'\x00' in data: refuse('DECLARATION_ENCODING')
        try: text=data.decode('utf-8','strict')
        except UnicodeError: refuse('DECLARATION_ENCODING')
        line=text.strip().split('\n',1)[0].strip()
        if line.startswith('v'): line=line[1:]
        return line if re.fullmatch(r'[0-9]{1,2}(?:\.[0-9]{1,3}){0,2}',line) else None
    except OSError: refuse('DECLARATION_IO')
    finally: os.close(fd)
def probe(tool,executable):
    try: process=subprocess.Popen([executable,'--version'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,close_fds=True)
    except OSError as error:
        if error.errno==errno.ENOENT: return ''
        if error.errno in (errno.EACCES,errno.EPERM): refuse('TOOL_ACCESS')
        refuse('TOOL_IO')
    selector=selectors.DefaultSelector(); output=[bytearray(),bytearray()]
    deadline=time.monotonic()+4
    try:
        for index,stream in enumerate((process.stdout,process.stderr)):
            os.set_blocking(stream.fileno(),False); selector.register(stream,selectors.EVENT_READ,index)
        while selector.get_map():
            remaining=deadline-time.monotonic()
            if remaining<=0: refuse('TOOL_TIMEOUT')
            for key,_ in selector.select(min(remaining,0.05)):
                try: data=os.read(key.fileobj.fileno(),4097)
                except BlockingIOError: continue
                if not data: selector.unregister(key.fileobj); continue
                buffer=output[key.data]
                if len(buffer)+len(data)>4096: refuse('TOOL_LIMIT')
                buffer.extend(data)
        remaining=deadline-time.monotonic()
        if remaining<=0: refuse('TOOL_TIMEOUT')
        try: status=process.wait(timeout=remaining)
        except subprocess.TimeoutExpired: refuse('TOOL_TIMEOUT')
        if status!=0: refuse('TOOL_EXIT')
        if any(b'\x00' in data for data in output): refuse('TOOL_ENCODING')
        try: texts=[data.decode('utf-8','strict') for data in output]
        except UnicodeError: refuse('TOOL_ENCODING')
        pattern=r'v([0-9]{1,2}\.[0-9]{1,3}\.[0-9]{1,3})\r?\n?' if tool=='node' else r'Python ([0-9]{1,2}\.[0-9]{1,3}\.[0-9]{1,3})\r?\n?'
        # Older Python sends its version to stderr; accept exactly one stream.
        text=texts[0] if texts[0] else texts[1]
        if texts[0] and texts[1]: refuse('TOOL_OUTPUT')
        match=re.fullmatch(pattern,text)
        if not match: refuse('TOOL_OUTPUT')
        return match.group(1)
    except OSError: refuse('TOOL_IO')
    finally:
        selector.close()
        if process.poll() is None:
            process.kill()
            try: process.wait(timeout=0.5)
            except subprocess.TimeoutExpired: pass
        process.stdout.close(); process.stderr.close()
def main():
    with open('/proc/sys/kernel/random/boot_id','r',encoding='ascii') as file: boot=file.read(64).strip()
    if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',boot): refuse('BOOT_ID')
    declarations={}
    for tool,name in (('node','.nvmrc'),('node','.node-version'),('python','.python-version')):
        if tool in declarations: continue
        value=declaration(name)
        if value: declarations[tool]=value
    values={tool:probe(tool,executable) for tool,executable in REQUEST['executables'].items()}
    return {'version':1,'ok':True,'bootId':boot,'declared':declarations,'actual':values}
try: response=main()
except Refused as error: response={'version':1,'ok':False,'code':error.code}
except Exception: response={'version':1,'ok':False,'code':'PROBE_INTERNAL'}
print(json.dumps(response,separators=(',',':'),ensure_ascii=True))
`;

export function runtimeProbeCommand(pins: { node?: string; python?: string } = {}) {
  const executables = { node: pins.node ? `/opt/sakura-runtimes/node-${version.parse(pins.node)}/bin/node` : 'node',
    python: pins.python ? `/opt/sakura-runtimes/python-${version.parse(pins.python)}/bin/python3` : 'python3' };
  return `exec /usr/bin/python3 -I -S - <<'SAKURA_RUNTIME_PROBE'\nREQUEST=${JSON.stringify({ executables })}\n${helper}SAKURA_RUNTIME_PROBE`;
}
