param(
  [ValidateRange(1, 65535)][int]$Port = 7337,
  [string]$ConfigPath = '',
  [switch]$Probe,
  [switch]$SelfTest,
  [switch]$StartOnce,
  [ValidateSet('on', 'off')][string]$SetServerAutostart = '',
  [ValidateRange(0, 10)][int]$ExitAfterSeconds = 0
)

$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'Sakura 托盘伴侣仅支持 Windows。'
}
$root = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $root 'scripts\launch.mjs'
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
  throw '请先运行 npm run build，或从已编译的 Sakura 运行包启动托盘。'
}
if (-not $ConfigPath) { $ConfigPath = Join-Path $env:LOCALAPPDATA 'Sakura\tray.json' }
$ConfigPath = [IO.Path]::GetFullPath($ConfigPath)

$settings = [ordered]@{ port = 7337; startServer = $false }
if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) {
  $saved = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($saved.port -isnot [int] -and $saved.port -isnot [long]) { throw '托盘端口配置无效。' }
  if ($saved.port -lt 1 -or $saved.port -gt 65535 -or $saved.startServer -isnot [bool]) {
    throw '托盘启动策略无效。'
  }
  $settings.port = [int]$saved.port
  $settings.startServer = [bool]$saved.startServer
}
if ($PSBoundParameters.ContainsKey('Port')) { $settings.port = $Port }

function Save-Settings {
  $folder = Split-Path -Parent $ConfigPath
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
  $temp = "$ConfigPath.$PID.tmp"
  try {
    [IO.File]::WriteAllText($temp, ($settings | ConvertTo-Json -Compress),
      [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temp -Destination $ConfigPath -Force
  } finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
  }
}

function Read-SakuraState {
  $url = "http://127.0.0.1:$($settings.port)/api/access/status"
  try {
    $response = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 2 -MaximumRedirection 0 -ErrorAction Stop
    if ($response.enabled -isnot [bool] -or $response.session.locked -isnot [bool] -or
        $response.session.configured -isnot [bool]) {
      return 'unexpected'
    }
    if ($response.session.locked) { return 'locked' }
    return 'running'
  } catch { return 'offline' }
}

function Start-SakuraServer {
  $state = Read-SakuraState
  if ($state -in @('running', 'locked')) {
    return [pscustomobject]@{ started = $false; pid = $null }
  }
  if ($state -eq 'unexpected') { throw '当前端口由其他服务占用。' }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $oldPort = $env:SAKURA_PORT
  try {
    $env:SAKURA_PORT = [string]$settings.port
    $process = Start-Process -FilePath $node -ArgumentList ('"{0}"' -f $entry) -WorkingDirectory $root -WindowStyle Hidden -PassThru
  } finally { $env:SAKURA_PORT = $oldPort }
  return [pscustomobject]@{ started = $true; pid = $process.Id }
}

if ($SetServerAutostart) {
  $settings.startServer = $SetServerAutostart -eq 'on'
  Save-Settings
  [pscustomobject]@{ port = $settings.port; startServer = $settings.startServer } |
    ConvertTo-Json -Compress
  exit 0
}

if ($Probe) {
  [pscustomobject]@{ port = $settings.port; state = Read-SakuraState;
    startServer = $settings.startServer } | ConvertTo-Json -Compress
  exit 0
}
if ($StartOnce) {
  $started = Start-SakuraServer
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    $state = Read-SakuraState
    if ($state -eq 'running' -or $state -eq 'locked') { break }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($state -ne 'running' -and $state -ne 'locked') { throw 'Sakura 服务未能启动。' }
  [pscustomobject]@{ port = $settings.port; state = $state;
    started = $started.started; pid = $started.pid } | ConvertTo-Json -Compress
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if ($SelfTest) {
  $checkIcon = [System.Windows.Forms.NotifyIcon]::new()
  $checkMenu = [System.Windows.Forms.ContextMenuStrip]::new()
  try {
    $checkIcon.Icon = [System.Drawing.SystemIcons]::Application
    $checkIcon.ContextMenuStrip = $checkMenu
    [pscustomobject]@{ port = $settings.port; formsReady = $true;
      state = Read-SakuraState } | ConvertTo-Json -Compress
  } finally { $checkIcon.Dispose(); $checkMenu.Dispose() }
  exit 0
}
if ($PSBoundParameters.ContainsKey('Port')) { Save-Settings }

$sha = [Security.Cryptography.SHA256]::Create()
try {
  $hash = [BitConverter]::ToString($sha.ComputeHash(
    [Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))).Replace('-', '').Substring(0, 12)
} finally { $sha.Dispose() }
$created = $false
$single = [Threading.Mutex]::new($true, "Local\SakuraTray-$hash", [ref]$created)
if (-not $created) { $single.Dispose(); exit 0 }

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runName = "SakuraTray-$hash"
$shell = (Get-Process -Id $PID).Path
$startupCommand = '"{0}" -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "{1}"' -f $shell, $MyInvocation.MyCommand.Path
if ($startupCommand.Length -gt 260) {
  $single.ReleaseMutex(); $single.Dispose()
  throw '安装路径过长，无法登记 Windows 登录启动。'
}
$dashboard = "http://127.0.0.1:$($settings.port)/"
$context = [System.Windows.Forms.ApplicationContext]::new()
$icon = [System.Windows.Forms.NotifyIcon]::new()
$menu = [System.Windows.Forms.ContextMenuStrip]::new()
$timer = [System.Windows.Forms.Timer]::new()
$exitTimer = [System.Windows.Forms.Timer]::new()
try {
  $icon.Icon = [System.Drawing.SystemIcons]::Application
  $icon.Text = 'Sakura · 正在检查'
  $icon.ContextMenuStrip = $menu
  $statusItem = $menu.Items.Add('正在检查 Sakura…')
  $statusItem.Enabled = $false
  [void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
  $openItem = $menu.Items.Add('打开 Sakura')
  $startItem = $menu.Items.Add('启动 Sakura')
  [void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
  $autoServerItem = $menu.Items.Add('托盘启动时启动 Sakura')
  $autoServerItem.Checked = $settings.startServer
  $logonItem = $menu.Items.Add('登录 Windows 时启动托盘')
  $registered = try { (Get-ItemPropertyValue -Path $runKey -Name $runName -ErrorAction Stop) -eq $startupCommand }
    catch { $false }
  $logonItem.Checked = $registered
  [void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
  $exitItem = $menu.Items.Add('退出托盘')

  $open = {
    Start-Process -FilePath $dashboard | Out-Null
  }
  $openItem.add_Click($open)
  $icon.add_DoubleClick($open)
  $startItem.add_Click({
    try {
      Start-SakuraServer | Out-Null
      $statusItem.Text = 'Sakura 正在启动…'
    } catch {
      [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Sakura 托盘') | Out-Null
    }
  })
  $autoServerItem.add_Click({
    $settings.startServer = -not $settings.startServer
    try {
      Save-Settings
      $autoServerItem.Checked = $settings.startServer
    } catch {
      $settings.startServer = -not $settings.startServer
      [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Sakura 托盘') | Out-Null
    }
  })
  $logonItem.add_Click({
    try {
      if ($logonItem.Checked) {
        Remove-ItemProperty -Path $runKey -Name $runName -ErrorAction Stop
        $logonItem.Checked = $false
      } else {
        New-Item -Path $runKey -Force | Out-Null
        Set-ItemProperty -Path $runKey -Name $runName -Value $startupCommand
        $logonItem.Checked = $true
      }
    } catch {
      [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Sakura 托盘') | Out-Null
    }
  })
  $exitItem.add_Click({ $context.ExitThread() })
  $timer.Interval = 5000
  $timer.add_Tick({
    $state = Read-SakuraState
    $labels = @{ running = '运行中'; locked = '会话已锁定'; offline = '未运行'; unexpected = '端口被其他服务占用' }
    $label = $labels[$state]
    $statusItem.Text = "Sakura · $label · 端口 $($settings.port)"
    $icon.Text = "Sakura · $label"
    $icon.Icon = if ($state -eq 'running') { [System.Drawing.SystemIcons]::Information }
      elseif ($state -eq 'locked') { [System.Drawing.SystemIcons]::Warning }
      else { [System.Drawing.SystemIcons]::Error }
    $startItem.Enabled = $state -eq 'offline'
  })
  if ($settings.startServer -and (Read-SakuraState) -eq 'offline') {
    $startItem.PerformClick()
  }
  $icon.Visible = $true
  $timer.Start()
  $initialState = Read-SakuraState
  $initialLabels = @{ running = '运行中'; locked = '会话已锁定'; offline = '未运行'; unexpected = '端口被其他服务占用' }
  $statusItem.Text = "Sakura · $($initialLabels[$initialState]) · 端口 $($settings.port)"
  if ($ExitAfterSeconds -gt 0) {
    $exitTimer.Interval = $ExitAfterSeconds * 1000
    $exitTimer.add_Tick({ $context.ExitThread() })
    $exitTimer.Start()
  }
  [System.Windows.Forms.Application]::Run($context)
} finally {
  $exitTimer.Stop()
  $exitTimer.Dispose()
  $timer.Stop()
  $icon.Visible = $false
  $timer.Dispose()
  $icon.Dispose()
  $menu.Dispose()
  $context.Dispose()
  $single.ReleaseMutex()
  $single.Dispose()
}
