/**
 * 模块职责：设置 SSH 身份文件权限，拒绝链接及特殊文件并适配 Windows OpenSSH 权限要求。
 * Module purpose: Sets SSH identity permissions, refusing links/special files and adapting Windows OpenSSH ACL requirements.
 */
import { hostExecFile } from './host-process.ts';
import { chmod, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AppError } from '../shared/errors.ts';
import { regularDirectory } from './local-store.ts';

/**
 * 入口 / Entry: literal.
 * 功能：从当前输入或状态计算 `"'" + value.replaceAll("'", "''") + "'"`，供调用方后续验证或使用。
 * Purpose: Computes `"'" + value.replaceAll("'", "''") + "'"` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `"'" + value.replaceAll("'", "''") + "'"`.
 * 副作用 / Effects: `value.replaceAll`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";

/** Windows OpenSSH rejects inherited access by ordinary users and groups. */
/**
 * 入口 / Entry: secureSshPaths.
 * 功能：在设置 SSH 身份文件权限中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`ssh-files.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ssh-files.ts`; this entry produces `void` for its caller. Module context: Sets SSH identity permissions, refusing links/special files and adapting Windows OpenSSH ACL requirements.
 * 处理：通过 `regularDirectory`, `dirname`, `lstat`, `info.isSymbolicLink` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `regularDirectory`, `dirname`, `lstat`, `info.isSymbolicLink`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!paths.length`; `process.platform !== 'win32'`.
 * 输入 / Inputs: paths: string[]
 * 输出 / Returns: `void`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())`; `cause instanceof AppError && cause.status === 503`; 异常 / errors `new AppError('SSH 文件不能是链接或特殊文件', 409)`; `cause`.
 * 失败处理：catch 分支执行 `if (cause instanceof AppError && cause.status === 503) throw cause;`; `const error = new AppError('无法设置 Windows OpenSSH 文件权限', 409);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (cause instanceof AppError && cause.status === 503) throw cause;`; `const error = new AppError('无法设置 Windows OpenSSH 文件权限', 409);`; these statements determine whether a failure is absorbed or rejected again.
 */
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
    await hostExecFile(
      'ssh-permissions',
      join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { timeout: 15_000 },
    );
  } catch (cause) {
    if (cause instanceof AppError && cause.status === 503) throw cause;
    const error = new AppError('无法设置 Windows OpenSSH 文件权限', 409);
    Object.defineProperty(error, 'cause', { value: cause });
    throw error;
  }
}
