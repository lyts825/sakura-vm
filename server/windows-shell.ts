import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { AppError } from './model.ts';

export type RegistryEntry = { path: string; name: string; value: string };
export type RegistryApply = (previous: RegistryEntry[], next: RegistryEntry[]) => Promise<void>;

// Arguments are JSON on stdin, never interpolated into PowerShell source. Only exact
// values owned by this installation are changed; foreign values and subkeys survive.
const registryScript = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
$root = [Microsoft.Win32.Registry]::CurrentUser
$prefix = [string]$inputData.root
$all = @{}
foreach ($e in @($inputData.previous) + @($inputData.next)) {
  $id = $e.path + [char]0 + $e.name
  if (-not $all.ContainsKey($id)) { $all[$id] = @{path=$e.path; name=$e.name; allowed=@(); old=$null; exists=$false} }
  $all[$id].allowed += [string]$e.value
}
try {
  foreach ($e in $all.Values) {
    $key = $root.OpenSubKey($prefix + '\\' + $e.path, $false)
    try {
      if ($key -and $key.GetValueNames() -contains $e.name) {
        if ($key.GetValueKind($e.name) -ne [Microsoft.Win32.RegistryValueKind]::String) { throw 'REGISTRY_CONFLICT' }
        $e.old = [string]$key.GetValue($e.name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $e.exists = $true
        if ($e.allowed -cnotcontains $e.old) { throw 'REGISTRY_CONFLICT' }
      }
    } finally { if ($key) { $key.Dispose() } }
  }
  try {
    $wanted = @{}
    foreach ($e in @($inputData.next)) {
      $wanted[$e.path + [char]0 + $e.name] = $true
      $key = $root.CreateSubKey($prefix + '\\' + $e.path)
      try { $key.SetValue($e.name, [string]$e.value, [Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() }
    }
    foreach ($entry in $all.GetEnumerator()) {
      if (-not $wanted.ContainsKey($entry.Key)) {
        $e = $entry.Value
        $key = $root.OpenSubKey($prefix + '\\' + $e.path, $true)
        if ($key) { try { $key.DeleteValue($e.name, $false) } finally { $key.Dispose() } }
      }
    }
  } catch {
    foreach ($e in $all.Values) {
      $key = $root.CreateSubKey($prefix + '\\' + $e.path)
      try {
        if ($e.exists) { $key.SetValue($e.name, $e.old, [Microsoft.Win32.RegistryValueKind]::String) }
        else { $key.DeleteValue($e.name, $false) }
      } finally { $key.Dispose() }
    }
    throw
  }
  # Remove only empty leaf keys. Never recursively remove a key or a parent owned by Windows.
  foreach ($path in @($all.Values | ForEach-Object { $_.path } | Sort-Object { $_.Length } -Descending)) {
    $key = $root.OpenSubKey($prefix + '\\' + $path, $false)
    $empty = $false
    if ($key) { try { $empty = $key.ValueCount -eq 0 -and $key.SubKeyCount -eq 0 } finally { $key.Dispose() } }
    if ($empty) { $root.DeleteSubKey($prefix + '\\' + $path, $false) }
  }
  if ($prefix -eq 'Software\\Classes') {
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class SakuraShellNotify { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e, uint f, IntPtr a, IntPtr b); }'
    [SakuraShellNotify]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
  }
  [Console]::Out.Write('{"ok":true}')
} catch {
  $code = if ($_.Exception.Message -eq 'REGISTRY_CONFLICT') { 'conflict' } else { 'failed' }
  [Console]::Out.Write(('{"error":"' + $code + '"}'))
  exit 1
}
`;

export function systemExecutable(name: 'powershell.exe' | 'explorer.exe' | 'notepad.exe') {
  const windows = process.env.SystemRoot || 'C:\\Windows';
  return name === 'powershell.exe'
    ? join(windows, 'System32', 'WindowsPowerShell', 'v1.0', name)
    : name === 'notepad.exe'
      ? join(windows, 'System32', name)
      : join(windows, name);
}

export function windowsRegistry(root = 'Software\\Classes'): RegistryApply {
  if (root !== 'Software\\Classes' && !/^Software\\Sakura\\IntegrationTests\\[a-f0-9-]{36}$/.test(root))
    throw new Error('Invalid registry root');
  return (previous, next) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        systemExecutable('powershell.exe'),
        [
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle',
          'Hidden',
          '-EncodedCommand',
          Buffer.from(registryScript, 'utf16le').toString('base64'),
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      const chunks: Buffer[] = [];
      let bytes = 0;
      const timer = setTimeout(() => child.kill(), 30000);
      child.stdout.on('data', (data: Buffer) => {
        bytes += data.length;
        if (bytes > 65536) child.kill();
        else chunks.push(data);
      });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.once('error', () => {
        clearTimeout(timer);
        reject(new AppError('无法运行 Windows 注册表工具', 503));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        const result = Buffer.concat(chunks).toString('utf8');
        if (code === 0 && result === '{"ok":true}') resolve();
        else
          reject(
            new AppError(
              result.includes('"conflict"')
                ? '注册项已被其他程序修改，请先恢复原值后重试；未覆盖其他程序设置'
                : 'Windows 集成注册未完成，请重试修复',
              409,
            ),
          );
      });
      child.stdin.end(JSON.stringify({ root, previous, next }));
    });
}

export function launchNative(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { shell: false, windowsHide: true, detached: true, stdio: 'ignore' });
    child.once('error', () => reject(new AppError('无法打开 Windows 程序，请检查编辑器是否安装', 503)));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
