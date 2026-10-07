/**
 * 模块职责：封装系统程序、注册表和原生启动，注册值已被其他程序修改时拒绝覆盖。
 * Module purpose: Wraps system tools, registry and native launch, refusing to overwrite registry values changed by another program.
 */
import { join } from 'node:path';
import { AppError } from '../shared/errors.ts';
import { hostProcess } from './host-process.ts';
import { processSupervisor, spawnObserved as spawn } from './process-supervisor.ts';

export type RegistryEntry = { path: string; name: string; value: string };
/**
 * 签名 / Signature: RegistryApply.RegistryApply.
 * 功能：为封装系统程序、注册表和原生启动声明 RegistryApply 的输入与结果契约，所属容器为 RegistryApply。
 * Purpose: Declares the input/result contract for RegistryApply in RegistryApply. Module responsibility: Wraps system tools, registry and native launch, refusing to overwrite registry values changed by another program.
 * 输入 / Inputs: previous: RegistryEntry[]; next: RegistryEntry[]
 * 输出 / Returns: Promise<void>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
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

/**
 * 入口 / Entry: systemExecutable.
 * 功能：从当前输入或状态计算 `name === 'powershell.exe' ? join(windows, 'System32', 'WindowsPowerShell', 'v1.0', name) : name === 'notepad.exe' ? join(wind…`，供调用方后续验证或使用。
 * Purpose: Computes `name === 'powershell.exe' ? join(windows, 'System32', 'WindowsPowerShell', 'v1.0', name) : name === 'notepad.exe' ? join(wind…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: name: 'powershell.exe' | 'explorer.exe' | 'notepad.exe'
 * 输出 / Returns: `name === 'powershell.exe' ? join(windows, 'System32', 'WindowsPowerShell', 'v1.0', name) : name === 'notepad.exe' ? join(wind…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function systemExecutable(name: 'powershell.exe' | 'explorer.exe' | 'notepad.exe') {
  const windows = process.env.SystemRoot || 'C:\\Windows';
  return name === 'powershell.exe'
    ? join(windows, 'System32', 'WindowsPowerShell', 'v1.0', name)
    : name === 'notepad.exe'
      ? join(windows, 'System32', name)
      : join(windows, name);
}

/**
 * 入口 / Entry: windowsRegistry.
 * 功能：在封装系统程序、注册表和原生启动中，执行此领域的具体处理步骤并返回其结果；本入口产生 `async (previous, next) => { const result = await hostProcess( 'windows-registry', systemExecutable('powershell.exe'), [ '-NoP…` 供上层消费（`windows-shell.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `windows-shell.ts`; this entry produces `async (previous, next) => { const result = await hostProcess( 'windows-registry', systemExecutable('powershell.exe'), [ '-NoP…` for its caller. Module context: Wraps system tools, registry and native launch, refusing to overwrite registry values changed by another program.
 * 处理：通过 `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: root: default='Software\\Classes'
 * 输出 / Returns: RegistryApply；结果来自 / values from `async (previous, next) => { const result = await hostProcess( 'windows-registry', systemExecutable('powershell.exe'), [ '-NoP…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `root !== 'Software\\Classes' && !/^Software\\Sakura\\IntegrationTests\\[a-f0-9-]{36}$/.test(root)`; 异常 / errors `new Error('Invalid registry root')`.
 */
export function windowsRegistry(root = 'Software\\Classes'): RegistryApply {
  if (root !== 'Software\\Classes' && !/^Software\\Sakura\\IntegrationTests\\[a-f0-9-]{36}$/.test(root))
    throw new Error('Invalid registry root');
  /**
   * 入口 / Entry: windowsRegistry.callback@94.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: previous; next
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0 || result.stdout !== '{"ok":true}'`; 异常 / errors `new AppError( result.stdout.includes('"conflict"') ? '注册项已被其他程序修改，请先恢复原值后重试；未覆盖其他程序设置' : 'Windows 集成注册未完成，请重试修复', 409, )`.
   */
  return async (previous, next) => {
    const result = await hostProcess(
      'windows-registry',
      systemExecutable('powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-EncodedCommand',
        Buffer.from(registryScript, 'utf16le').toString('base64'),
      ],
      { timeout: 30000, maxBuffer: 65536, input: JSON.stringify({ root, previous, next }) },
    );
    if (result.code !== 0 || result.stdout !== '{"ok":true}')
      throw new AppError(
        result.stdout.includes('"conflict"')
          ? '注册项已被其他程序修改，请先恢复原值后重试；未覆盖其他程序设置'
          : 'Windows 集成注册未完成，请重试修复',
        409,
      );
  };
}

/**
 * 入口 / Entry: launchNative.
 * 功能：在封装系统程序、注册表和原生启动中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`windows-shell.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `windows-shell.ts`; the calls and state transitions below complete the operation. Module context: Wraps system tools, registry and native launch, refusing to overwrite registry values changed by another program.
 * 处理：通过 `processSupervisor.observe`, `owned.waitForClose` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `processSupervisor.observe`, `owned.waitForClose`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file: string; args: string[]
 * 输出 / Returns: Promise<void>.
 * 副作用 / Effects: `processSupervisor.observe`.
 * 拒绝 / Refusals: 异常 / errors `error`.
 * 失败处理：catch 分支执行 `await owned.waitForClose();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `await owned.waitForClose();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function launchNative(file: string, args: string[]): Promise<void> {
  const owned = await processSupervisor.observe('windows-user-application', () =>
    spawn(file, args, { shell: false, windowsHide: true, detached: true, stdio: 'ignore' }),
  );
  const child = owned.child;
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', () => reject(new AppError('无法打开 Windows 程序，请检查编辑器是否安装', 503)));
      child.once('spawn', () => {
        child.unref();
        owned.handoffToUser();
        resolve();
      });
    });
  } catch (error) {
    await owned.waitForClose();
    throw error;
  }
}
