/** 固定会话私有文件的分块运输；不扩张公共 execInput 或 stdout 限额。 */
import { z } from 'zod';
import type { VmAccess } from './vm-access.ts';
import { quote } from './shell.ts';
import { executionSha } from './suite-execution-files.ts';
import { AppError } from '../shared/errors.ts';
const receipt = z
  .object({
    format: z.literal('sakura-suite-transport/1'),
    bytes: z
      .number()
      .int()
      .positive()
      .max(8 * 1024 ** 2),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    inode: z.string().regex(/^\d+$/),
    mtimeNs: z.string().regex(/^\d+$/),
  })
  .strict();
export class SuiteExecutionTransport {
  readonly root: string;
  constructor(
    private vm: VmAccess,
    private vmId: string,
    sessionId: string,
    private check: () => Promise<void>,
    private signal: AbortSignal,
  ) {
    this.root = '/var/lib/sakura-suite/' + z.uuid().parse(sessionId);
  }
  async initialize() {
    await this.check();
    const code =
      "import pathlib,stat,os\np=pathlib.Path('/var/lib/sakura-suite')\np.mkdir(mode=0o755,parents=True,exist_ok=True)\ns=p.lstat()\nassert stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not(s.st_mode&0o022)\nr=pathlib.Path(" +
      JSON.stringify(this.root) +
      ')\nr.mkdir(mode=0o755)';
    const value = await this.vm.exec(this.vmId, 'python3 -I -S -c ' + quote(code), 10000, this.signal);
    if (value.code) throw new AppError('固定运输目录未建立', 409, 'SUITE_EXECUTION_TRANSPORT');
  }
  async put(name: 'worker.py' | 'guardian.py' | 'input.json', bytes: Buffer, maximum: number) {
    if (bytes.length > maximum || maximum > 8 * 1024 ** 2)
      throw new AppError('固定运输输入越界', 413, 'SUITE_EXECUTION_INPUT_BUDGET');
    const path = this.root + '/' + name;
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
      await this.check();
      const chunk = bytes.subarray(offset, offset + 64 * 1024),
        code =
          'import os,sys,stat\np=' +
          JSON.stringify(path) +
          '\nfd=os.open(p,os.O_WRONLY|os.O_NOFOLLOW|' +
          (offset === 0 ? 'os.O_CREAT|os.O_EXCL' : 'os.O_APPEND') +
          ",0o600)\nwith os.fdopen(fd,'ab') as f:\n s=os.fstat(f.fileno())\n assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==0 and not(s.st_mode&0o022) and s.st_size==" +
          offset +
          '\n b=sys.stdin.buffer.read(65537)\n assert len(b)==' +
          chunk.length +
          '\n f.write(b);f.flush();os.fsync(f.fileno())';
      const value = await this.vm.execInput(
        this.vmId,
        'python3 -I -S -c ' + quote(code),
        chunk,
        10000,
        this.signal,
      );
      if (value.code) throw new AppError('固定输入块未确认', 409, 'SUITE_EXECUTION_TRANSPORT');
    }
    const code =
      'import os,stat,hashlib\np=' +
      JSON.stringify(path) +
      '\ns=os.lstat(p)\nassert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==0 and s.st_size==' +
      bytes.length +
      "\nassert hashlib.sha256(open(p,'rb').read()).hexdigest()==" +
      JSON.stringify(executionSha(bytes)) +
      '\nos.chmod(p,' +
      (name === 'input.json' ? '0o400' : '0o444') +
      ')';
    await this.check();
    const sealed = await this.vm.exec(this.vmId, 'python3 -I -S -c ' + quote(code), 10000, this.signal);
    if (sealed.code) throw new AppError('固定输入摘要不符', 409, 'SUITE_EXECUTION_TRANSPORT_DIGEST');
  }
  async read(raw: unknown) {
    const manifest = receipt.parse(raw),
      parts: Buffer[] = [];
    for (let offset = 0; offset < manifest.bytes; offset += 64 * 1024) {
      await this.check();
      const length = Math.min(64 * 1024, manifest.bytes - offset),
        code =
          'import os,stat,base64\np=' +
          JSON.stringify(this.root + '/output.json') +
          "\nfd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)\nwith os.fdopen(fd,'rb') as f:\n s=os.fstat(f.fileno())\n assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==0 and not(s.st_mode&0o222) and s.st_size==" +
          manifest.bytes +
          ' and str(s.st_ino)==' +
          JSON.stringify(manifest.inode) +
          ' and str(s.st_mtime_ns)==' +
          JSON.stringify(manifest.mtimeNs) +
          '\n f.seek(' +
          offset +
          ')\n b=f.read(' +
          length +
          ')\n assert len(b)==' +
          length +
          "\n print(base64.b64encode(b).decode('ascii'))";
      const value = await this.vm.exec(this.vmId, 'python3 -I -S -c ' + quote(code), 10000, this.signal);
      if (value.code) throw new AppError('原输出块读取未确认', 409, 'SUITE_EXECUTION_TRANSPORT');
      const part = Buffer.from(value.stdout.trim(), 'base64');
      if (part.length !== length || part.toString('base64') !== value.stdout.trim())
        throw new AppError('原输出块格式错误', 409, 'SUITE_EXECUTION_TRANSPORT');
      parts.push(part);
    }
    const bytes = Buffer.concat(parts);
    if (bytes.length !== manifest.bytes || executionSha(bytes) !== manifest.digest)
      throw new AppError('完整原输出摘要不符', 409, 'SUITE_EXECUTION_TRANSPORT_DIGEST');
    return bytes;
  }
}
