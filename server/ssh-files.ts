import { execFile } from 'node:child_process';
import { chmod, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { AppError } from './model.ts';
import { regularDirectory } from './local-store.ts';

const execute = promisify(execFile);
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";

/** Windows OpenSSH rejects inherited access by ordinary users and groups. */
export async function secureSshPaths(paths: string[]) {
  if (!paths.length) return;
  for (const path of paths) {
    await regularDirectory(dirname(path));
    const info = await lstat(path);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
      throw new AppError('SSH 文件不能是链接或特殊文件', 409);
    if (process.platform !== 'win32') await chmod(path, info.isDirectory() ? 0o700 : 0o600);
  }
  if (process.platform !== 'win32') return;
  const script =
    `$ErrorActionPreference='Stop'\n` +
    `$owner=[System.Security.Principal.WindowsIdentity]::GetCurrent().User\n` +
    `$principals=@($owner,[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))\n` +
    `foreach ($path in @(${paths.map(literal).join(',')})) {\n` +
    ` $attributes=[System.IO.File]::GetAttributes($path)\n` +
    ` if ($attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'SSH path changed to a link' }\n` +
    ` $directory=$attributes -band [System.IO.FileAttributes]::Directory\n` +
    ` $inherit=[System.Security.AccessControl.InheritanceFlags]::None\n` +
    ` if ($directory) { $acl=[System.Security.AccessControl.DirectorySecurity]::new(); $inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' }\n` +
    ` else { $acl=[System.Security.AccessControl.FileSecurity]::new() }\n` +
    ` $acl.SetOwner($owner); $acl.SetAccessRuleProtection($true,$false)\n` +
    ` foreach ($principal in $principals) { $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($principal,'FullControl',$inherit,'None','Allow')) }\n` +
    ` if ($directory) { [System.IO.Directory]::SetAccessControl($path,$acl) } else { [System.IO.File]::SetAccessControl($path,$acl) }\n` +
    `}\n`;
  try {
    await execute(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 15_000 },
    );
  } catch (cause) {
    const error = new AppError('无法设置 Windows OpenSSH 文件权限', 409);
    Object.defineProperty(error, 'cause', { value: cause });
    throw error;
  }
}
