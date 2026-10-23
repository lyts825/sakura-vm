/** 固定客户机文件操作；拒绝路径链接并按摘要比较后替换单文件。
 * Fixed guest file operations: reject symlinks and replace one file after digest checks. */
import type { VmAccess } from './vm-access.ts';
import { quote } from './shell.ts';
import { AppError } from '../shared/errors.ts';
import { repairFilesSchema } from '../shared/contracts/repair-session.ts';
import { z } from 'zod';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { GitProjectTasks } from './git-project-task.ts';

export const repairFileProgram = `import os,sys,json,stat,hashlib,uuid
p=json.load(sys.stdin)
def directory(path):
 if not path.startswith('/') or any(x in ('.','..') for x in path.split('/')): raise ValueError('invalid root')
 fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
 for part in filter(None,path.split('/')):
  child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=child
 return fd
def parent(root,path):
 parts=path.split('/')
 if not path or path.startswith('/') or any(not x or x in ('.','..','.git','.ssh','.env') or '\\\\' in x for x in parts): raise ValueError('invalid path')
 fd=os.dup(root)
 for part in parts[:-1]:
  child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=child
 return fd,parts[-1]
def read(root,path):
 fd,name=parent(root,path)
 try:
  f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
  try:
   info=os.fstat(f)
   if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_size>16000: raise ValueError('unsupported file')
   data=os.read(f,16001)
   if len(data)>16000 or b'\\0' in data: raise ValueError('unsupported content')
   return data.decode('utf-8'),hashlib.sha256(data).hexdigest(),info
  finally: os.close(f)
 finally: os.close(fd)
root=directory(p['root'])
try:
 files=[]
 for path in p['paths']:
  content,sha,info=read(root,path);files.append({'path':path,'content':content})
  if 'expected' in p and p['expected'].get(path)!=sha: raise ValueError('file changed')
 if sum(len(x['content'].encode()) for x in files)>16000: raise ValueError('context too large')
 if p.get('replacement') is not None:
  path=p['target']; data=p['replacement'].encode('utf-8')
  if len(data)>16000: raise ValueError('replacement too large')
  original,sha,info=read(root,path)
  if p['expected'].get(path)!=sha: raise ValueError('file changed')
  fd,name=parent(root,path); temp='.sakura-repair-'+uuid.uuid4().hex
  try:
   out=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
   try:
    os.fchown(out,info.st_uid,info.st_gid);os.fchmod(out,stat.S_IMODE(info.st_mode)&0o777)
    with os.fdopen(out,'wb',closefd=False) as stream: stream.write(data);stream.flush();os.fsync(out)
   finally: os.close(out)
   _,lastsha,last=read(root,path)
   if lastsha!=sha or (last.st_dev,last.st_ino)!=(info.st_dev,info.st_ino): raise ValueError('file changed')
   check=os.stat(name,dir_fd=fd,follow_symlinks=False)
   if not stat.S_ISREG(check.st_mode) or (check.st_dev,check.st_ino)!=(info.st_dev,info.st_ino): raise ValueError('file replaced')
   for selected in p['paths']:
    _,selectedsha,_=read(root,selected)
    if p['expected'].get(selected)!=selectedsha: raise ValueError('context changed')
   os.replace(temp,name,src_dir_fd=fd,dst_dir_fd=fd);os.fsync(fd)
  finally:
   try: os.unlink(temp,dir_fd=fd)
   except FileNotFoundError: pass
   os.close(fd)
 print(json.dumps({'files':files}))
finally: os.close(root)
`;

/** 文件任务必须沿用捕获的项目版本与运行代次。 File tasks must retain the captured project version and runtime generation. */
export type RepairFileGuard = { workspaces: WorkspacesV1; version: string; assertCurrent: () => void };

/** 在项目身份租约内执行固定程序，正文仅作为编码数据传入。
 * Execute a fixed program under the project identity lease; pass content only as encoded data. */
export async function repairFiles(machines: VmAccess, id: string, input: {
  root: string; paths: string[]; expected?: Record<string, string>; target?: string; replacement?: string;
}, signal: AbortSignal | undefined, guard: RepairFileGuard) {
  const tasks = new GitProjectTasks(machines, guard.workspaces);
  try {
    guard.assertCurrent();
    const captured = await tasks.capture(id);
    if (captured.version !== guard.version || captured.project.directory !== input.root)
      throw new AppError('项目配置已变化，请重新选择文件', 409);
    guard.assertCurrent();
    const data = Buffer.from(JSON.stringify(input)).toString('base64');
    const program = repairFileProgram.replace('p=json.load(sys.stdin)', `p=json.loads(__import__('base64').b64decode('${data}'))`);
    return await tasks.runCaptured(captured, signal, async () => {
      guard.assertCurrent();
      const result = await tasks.exec(id, '/usr/bin/python3 -I -S -c ' + quote(program), 30_000, signal);
      if (result.code !== 0) throw new AppError('文件读取或摘要核对失败；需要系统 Python 3、项目账号可访问的普通 UTF-8 文件及无符号链接的路径', 409, 'REPAIR_FILE_REFUSED');
      guard.assertCurrent();
      return z.object({ files: repairFilesSchema }).strict().parse(JSON.parse(result.stdout)).files;
    });
  } finally { await tasks.close(); }
}
