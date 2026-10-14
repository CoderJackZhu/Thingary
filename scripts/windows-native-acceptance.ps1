# Installed Windows acceptance. Refuses existing acceptance data or mismatched identity.
[CmdletBinding()]
param(
  [string]$Installer,
  [string]$ArtifactRoot = '.local/windows-native-acceptance',
  [string]$FixtureArchive,
  [ValidateSet('', 'inspect', 'resize', 'close')][string]$WindowOnly = '',
  [int]$ApplicationPid = 0,
  [int]$Width = 1600,
  [int]$Height = 1000
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Installed native acceptance requires Windows.' }
$Identity = 'local.thingary.win.acceptance'
$ExpectedWindowTitle = '物谱 · Windows 验收'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AcceptanceWindow {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr z,int x,int y,int w,int hgt,uint flags);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out RECT r);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,System.Text.StringBuilder s,int max);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int state);
 [UnmanagedFunctionPointer(CallingConvention.Winapi)]
 [return: MarshalAs(UnmanagedType.Bool)]
 public delegate bool EnumWindowsProc(IntPtr h,IntPtr parameter);
 [DllImport("user32.dll")]
 [return: MarshalAs(UnmanagedType.Bool)]
 private static extern bool EnumWindows(EnumWindowsProc callback,IntPtr parameter);
 [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h,out uint processId);
 [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
 public static IntPtr FindVisibleWindow(int processId,string exactTitle) {
   IntPtr found=IntPtr.Zero;
   int matches=0;
   // Process.MainWindowHandle may identify Tauri's hidden single-instance
   // coordination window. Inspect titles only on this PID's visible windows.
   EnumWindowsProc callback=delegate(IntPtr h,IntPtr parameter) {
     uint owner;
     GetWindowThreadProcessId(h,out owner);
     if (owner==(uint)processId && IsWindowVisible(h)) {
       var title=new System.Text.StringBuilder(512);
       GetWindowText(h,title,title.Capacity);
       if (String.Equals(title.ToString(),exactTitle,StringComparison.Ordinal)) {
         found=h;
         matches++;
       }
     }
     return true;
   };
   if (!EnumWindows(callback,IntPtr.Zero)) {
     throw new InvalidOperationException("Unable to enumerate native windows.");
   }
   if (matches>1) {
     throw new InvalidOperationException("Multiple visible acceptance windows for the same process.");
   }
   return found;
 }
}
'@
function Window-State([int]$ProcessId, [string]$Action, [int]$W, [int]$H) {
  $process = Get-Process -Id $ProcessId
  $process.Refresh()
  $handle = [AcceptanceWindow]::FindVisibleWindow($ProcessId, $ExpectedWindowTitle)
  if ($handle -eq [IntPtr]::Zero) { throw "Refuse unrelated windows: process $ProcessId has no visible window with exact title '$ExpectedWindowTitle'." }
  $title = New-Object System.Text.StringBuilder 512
  [void][AcceptanceWindow]::GetWindowText($handle, $title, $title.Capacity)
  if ($title.ToString() -cne $ExpectedWindowTitle) { throw "Refuse unrelated window: $title" }
  $scale=[AcceptanceWindow]::GetDpiForWindow($handle)/96.0
  if ($scale -le 0) { $scale=1.0 }
  if ($Action -eq 'close') {
    if (-not [AcceptanceWindow]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'WM_CLOSE failed.' }
  } elseif ($Action -eq 'resize') {
    [void][AcceptanceWindow]::ShowWindow($handle, 9)
    $frame=New-Object AcceptanceWindow+RECT
    $content=New-Object AcceptanceWindow+RECT
    [void][AcceptanceWindow]::GetWindowRect($handle,[ref]$frame)
    [void][AcceptanceWindow]::GetClientRect($handle,[ref]$content)
    $outerW=[int][Math]::Round($W*$scale)+($frame.Right-$frame.Left)-($content.Right-$content.Left)
    $outerH=[int][Math]::Round($H*$scale)+($frame.Bottom-$frame.Top)-($content.Bottom-$content.Top)
    if (-not [AcceptanceWindow]::SetWindowPos($handle, [IntPtr]::Zero, 0, 0, $outerW, $outerH, 0x0004)) { throw 'Native resize failed.' }
  }
  $outer = New-Object AcceptanceWindow+RECT
  $client = New-Object AcceptanceWindow+RECT
  [void][AcceptanceWindow]::GetWindowRect($handle, [ref]$outer)
  [void][AcceptanceWindow]::GetClientRect($handle, [ref]$client)
  return @{ dpiScale=$scale; requestedLogicalClient=@{ width=$W; height=$H }; pid=$ProcessId; title=$title.ToString(); handle=$handle.ToInt64(); outer=@{ width=$outer.Right-$outer.Left; height=$outer.Bottom-$outer.Top }; client=@{ width=$client.Right-$client.Left; height=$client.Bottom-$client.Top } }
}
if ($WindowOnly) { Window-State $ApplicationPid $WindowOnly $Width $Height | ConvertTo-Json -Depth 5 -Compress; return }
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot
$Output = if ([IO.Path]::IsPathRooted($ArtifactRoot)) { [IO.Path]::GetFullPath($ArtifactRoot) } else { [IO.Path]::GetFullPath((Join-Path $RepoRoot $ArtifactRoot)) }
if (Test-Path $Output) { throw 'Artifact output must be a new directory; choose another -ArtifactRoot.' }
[void](New-Item -ItemType Directory -Path $Output)
$DataRoot = Join-Path $env:LOCALAPPDATA $Identity
$ConfigRoot = Join-Path $env:APPDATA $Identity
$Summary = [ordered]@{ identity=$Identity; started=(Get-Date).ToUniversalTime().ToString('o'); verified=@(); unverified=@('Visible toast delivery after queue deadline','Windows 11 desktop','Chinese IME and Narrator','interactive installer/uninstaller checkboxes','manual native file dialogs'); status='running'; nativeUI=@() }
$AppProcess = $null
$InstalledExe = $null
$InstalledDir = $null
$NotifyReady = $false
$NotificationDriver = $null
$NotificationFailure = $null
$OwnedWebViewProcesses = @{}
$WindowsTarget = 'x86_64-pc-windows-msvc'
function Save-Summary { $Summary | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $Output 'summary.json') -Encoding utf8 }
function Assert-Exit([string]$Name) { if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" } }
function Run-Tool([string]$File, [string[]]$Arguments, [string]$Log) {
  & $File @Arguments 2>&1 | Tee-Object -FilePath (Join-Path $Output $Log) | Write-Host
  Assert-Exit $Log
}
function Wait-Condition([scriptblock]$Condition, [string]$Label, [int]$Seconds=30) {
  $end=(Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $end) { if (& $Condition) { return }; Start-Sleep -Milliseconds 200 }
  throw "$Label timed out"
}
# PID + creation time identifies only this acceptance instance's WebView2.
# Profile ownership also finds an orphaned browser after the app has exited.
function Get-OwnWebViewProcesses {
  $processes=@(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'")
  $parents=@{}
  if ($null -ne $AppProcess) {
    $AppProcess.Refresh()
    if (-not $AppProcess.HasExited) { $parents[$AppProcess.Id]=$AppProcess.StartTime.ToUniversalTime().Ticks }
  }
  $acceptanceProfilePattern=[Regex]::Escape($DataRoot)
  $profileArgument='(?i)(?:^|\s)--user-data-dir=(?:"'+$acceptanceProfilePattern+'[\\/][^"]*"|'+$acceptanceProfilePattern+'[\\/]\S*(?=\s|$))'
  do {
    $previousCount=$parents.Count
    foreach ($process in $processes) {
      $created=$process.CreationDate.ToUniversalTime().Ticks
      $key="$($process.ProcessId):$created"
      $ownChild=$parents.ContainsKey([int]$process.ParentProcessId) -and $created -ge $parents[[int]$process.ParentProcessId]
      if ($OwnedWebViewProcesses.ContainsKey($key) -or $ownChild -or $process.CommandLine -match $profileArgument) {
        $parents[[int]$process.ProcessId]=$created
        $OwnedWebViewProcesses[$key]=$true
      }
    }
  } while ($parents.Count -ne $previousCount)
  return @($processes | Where-Object { $OwnedWebViewProcesses.ContainsKey("$($_.ProcessId):$($_.CreationDate.ToUniversalTime().Ticks)") })
}
function Wait-OwnWebViewExit {
  Wait-Condition { @(Get-OwnWebViewProcesses).Count -eq 0 } 'own acceptance WebView2 process exit' 30
}
function Start-Acceptance {
  # Identity was read from installed BUILD_INFO and shortcut before any launch.
  $script:AppProcess=Start-Process -FilePath $InstalledExe -PassThru
  Wait-Condition {
    $script:AppProcess.Refresh()
    if ($script:AppProcess.HasExited) { throw 'Installed acceptance process exited before its visible window appeared.' }
    [AcceptanceWindow]::FindVisibleWindow($script:AppProcess.Id, $ExpectedWindowTitle) -ne [IntPtr]::Zero
  } 'visible installed window with exact acceptance title' 45
  $state=Window-State $AppProcess.Id 'inspect' 0 0
  $Summary.window=$state
  [void](Get-OwnWebViewProcesses)
}
function Stop-Acceptance {
  if ($null -eq $AppProcess) { return }
  [void](Get-OwnWebViewProcesses)
  $AppProcess.Refresh()
  if (-not $AppProcess.HasExited) {
    [void](Window-State $AppProcess.Id 'close' 0 0)
    Wait-Condition { [void](Get-OwnWebViewProcesses); $script:AppProcess.Refresh(); $script:AppProcess.HasExited } 'native clean close' 20
  }
  Wait-OwnWebViewExit
  $script:AppProcess=$null
}
function UI([string]$Mode, [string]$Label='result') {
  Run-Tool 'node' @('scripts/windows-native-ui.mjs','--mode',$Mode,'--output',$Output,'--pid',"$($AppProcess.Id)",'--label',$Label,'--notification-driver',"$NotificationDriver") "ui-$Mode-$Label.log"
  $result=Get-Content (Join-Path $Output "ui-$Mode-$Label.json") -Raw | ConvertFrom-Json
  $Summary.nativeUI+=@{ mode=$Mode; label=$Label; status=$result.status; runtime=$result.runtime; verified=$result.verified; unverified=$result.unverified; screenshots=$result.screenshots }
}
function Install-Acceptance {
  $installation=Start-Process -FilePath $Installer -ArgumentList '/S' -PassThru -Wait
  if ($installation.ExitCode -ne 0) { throw "NSIS install exit $($installation.ExitCode)" }
  $startmenu=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  $shell=New-Object -ComObject WScript.Shell
  $namespace=New-Object -ComObject Shell.Application
  $matches=@(Get-ChildItem -LiteralPath $startmenu -Recurse -Filter '*.lnk' | Where-Object { $_.BaseName -eq 'Thingary Windows Acceptance' })
  if ($matches.Count -ne 1) { throw "Expected one isolated Start Menu shortcut; got $($matches.Count)" }
  $shortcut=$shell.CreateShortcut($matches[0].FullName)
  $item=$namespace.NameSpace($matches[0].DirectoryName).ParseName($matches[0].Name)
  $aumid=$item.ExtendedProperty('System.AppUserModel.ID')
  if ($aumid -ne $Identity) { throw "Installed shortcut AUMID mismatch: $aumid" }
  $script:InstalledExe=$shortcut.TargetPath
  $script:InstalledDir=Split-Path -Parent $InstalledExe
  if (-not (Test-Path -LiteralPath $InstalledExe)) { throw 'Installed executable missing.' }
  $infoPath=Join-Path $InstalledDir '许可\BUILD_INFO.json'
  $info=Get-Content -LiteralPath $infoPath -Raw | ConvertFrom-Json
  if ($info.identity -ne $Identity -or -not $info.acceptance) { throw 'Refuse launching non-acceptance installed package.' }
  $head=(& git rev-parse HEAD).Trim(); Assert-Exit 'git HEAD'
  if ($info.source_commit -ne $head) { throw 'Installed package source commit mismatch.' }
  $package=Get-Content package.json -Raw | ConvertFrom-Json
  if ($info.version -ne $package.version) { throw 'Installed version mismatch.' }
  $notices=(Get-FileHash -LiteralPath (Join-Path $InstalledDir '许可\THIRD_PARTY_NOTICES.txt') -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($notices -ne $info.third_party_notices_sha256) { throw 'Installed notices hash mismatch.' }
  $Summary.package=$info
  $Summary.installed=@{ executable=$InstalledExe; shortcut=$matches[0].FullName; aumid=$aumid; installerSha256=(Get-FileHash $Installer -Algorithm SHA256).Hash.ToLowerInvariant() }
  $script:NotifyReady=$true
}
function Data-Hashes([string]$Label='data') {
  Wait-OwnWebViewExit
  $deadline=(Get-Date).AddSeconds(30)
  $previous=$null; $stable=0; $attempts=0; $transientErrors=0
  while ((Get-Date) -lt $deadline) {
    $attempts++
    try {
      if (@(Get-OwnWebViewProcesses).Count) { $stable=0; $previous=$null; Start-Sleep -Milliseconds 500; continue }
      # Always re-enumerate and hash every file, including the WebView2 profile.
      $files=@(Get-ChildItem -LiteralPath $DataRoot -File -Recurse | Sort-Object FullName)
      if (-not $files.Count) { throw 'Acceptance app data missing.' }
      $hashes=[ordered]@{}
      foreach ($file in $files) { $hashes[$file.FullName.Substring($DataRoot.Length)]=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }
      $manifest=$hashes | ConvertTo-Json -Compress
      if ($manifest -eq $previous) { $stable++ } else { $stable=1; $previous=$manifest }
      if ($stable -ge 3) {
        if (-not $Summary.Contains('dataHashQuiescence')) { $Summary.dataHashQuiescence=@() }
        $Summary.dataHashQuiescence+=@{ label=$Label; files=$files.Count; trackedOwnWebViewProcesses=$OwnedWebViewProcesses.Count; attempts=$attempts; transientErrors=$transientErrors; identicalCompleteManifests=$stable; intervalMilliseconds=500; observedAt=(Get-Date).ToUniversalTime().ToString('o') }
        return $hashes
      }
    } catch {
      $exception=$_.Exception; $retry=$false
      while ($null -ne $exception) {
        if ($exception -is [IO.IOException] -and (($exception.HResult -band 0xffff) -in @(2,3,32,33))) { $retry=$true; break }
        $exception=$exception.InnerException
      }
      if (-not $retry) { throw }
      $transientErrors++; $stable=0; $previous=$null
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Complete acceptance data hashes did not become stable within 30 seconds ($Label; $transientErrors transient IO errors)."
}
function Notify([string]$Action) {
  if (-not $NotifyReady) { throw 'Installed acceptance AUMID has not been verified.' }
  if ($NotificationDriver) {
    $lines=@(& $NotificationDriver $Action 2> (Join-Path $Output "notification-$Action.stderr.log"))
  } else {
    $lines=@(& cargo run --manifest-path src-tauri/Cargo.toml --target $WindowsTarget --features fault-injection --example windows_notifications -- $Action 2> (Join-Path $Output "notification-$Action.stderr.log"))
  }
  Assert-Exit "notification $Action"
  $value=($lines -join "`n") | ConvertFrom-Json
  if ($value.identifier -ne $Identity) { throw 'Notification driver identity mismatch.' }
  $value | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $Output "notification-$Action.json") -Encoding utf8
  @{ action=$Action; observed=(Get-Date).ToUniversalTime().ToString('o'); evidence=$value } | ConvertTo-Json -Depth 10 -Compress | Add-Content (Join-Path $Output 'notification-observations.jsonl') -Encoding utf8
  return $value
}
try {
  if ((Test-Path $DataRoot) -or (Test-Path $ConfigRoot)) { throw 'Acceptance identity is not fresh. Never overwrite existing data.' }
  $os=Get-CimInstance Win32_OperatingSystem
  $Summary.os=@{ caption=$os.Caption; version=$os.Version; build=$os.BuildNumber; architecture=$os.OSArchitecture; session=$env:SESSIONNAME; userInteractive=[Environment]::UserInteractive; processSession=(Get-Process -Id $PID).SessionId; runner=$env:RUNNER_OS; productType=$os.ProductType; processArchitecture=[Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString(); runtimeOsArchitecture=[Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() }
  $Summary.os.windows11Workstation=($os.ProductType -eq 1 -and [int]$os.BuildNumber -ge 22000 -and $os.Caption -match 'Windows 11')
  if ($Summary.os.windows11Workstation) { $Summary.unverified=@($Summary.unverified | Where-Object { $_ -ne 'Windows 11 desktop' }) }
  if ($Summary.os.runtimeOsArchitecture -eq 'Arm64') { $Summary.unverified+=@('Native x64 Windows hardware'); $Summary.os.appExecution='x64 application under Windows ARM emulation' }
  $Summary.node=(& node --version).Trim(); Assert-Exit 'node'
  if ([int]($Summary.node -replace '^v(\d+).*','$1') -lt 22) { throw 'Node 22 or newer required.' }
  if (-not $Installer) {
    $candidates=@(Get-ChildItem 'src-tauri/target/x86_64-pc-windows-msvc/debug/bundle/nsis' -Filter '*.exe' | Where-Object { $_.Name -like '*Acceptance*' })
    if ($candidates.Count -ne 1) { throw "Expected one debug acceptance NSIS installer; got $($candidates.Count)" }
    $Installer=$candidates[0].FullName
  }
  $Installer=[IO.Path]::GetFullPath($Installer)
  if ($Installer -notlike '*Acceptance*' -or $Installer -notlike '*debug*bundle*nsis*') { throw 'Pass the isolated debug acceptance NSIS installer.' }
  $fixture=Join-Path $Output 'fixture'
  if ($FixtureArchive) {
    $FixtureArchive=[IO.Path]::GetFullPath($FixtureArchive)
    Run-Tool 'cargo' @('run','--manifest-path','src-tauri/Cargo.toml','--target',$WindowsTarget,'--features','fault-injection','--example','cross_platform_backup','--','restore',$FixtureArchive,$fixture) 'fixture-restore.log'
  } else { Run-Tool 'cargo' @('run','--manifest-path','src-tauri/Cargo.toml','--target',$WindowsTarget,'--features','fault-injection','--example','cross_platform_backup','--','create',$fixture) 'fixture-create.log' }
  $restored=Join-Path $Output 'fixture-restored'
  Run-Tool 'cargo' @('run','--manifest-path','src-tauri/Cargo.toml','--target',$WindowsTarget,'--features','fault-injection','--example','cross_platform_backup','--','restore',(Join-Path $fixture 'fixture.thingary'),$restored) 'fixture-roundtrip.log'
  if ((Get-Content (Join-Path $fixture 'snapshot.json') -Raw) -ne (Get-Content (Join-Path $restored 'snapshot.json') -Raw)) { throw 'Restored fixture tables/payload hashes differ.' }
  Install-Acceptance
  $Summary.verified+=@('NSIS current user installed','installed shortcut identity/source/version/notices','fictional backup restore table counts and payload hashes')
  # Collect independent UI evidence even when notifications fail; all stages must pass.
  try {
    Run-Tool 'cargo' @('build','--manifest-path','src-tauri/Cargo.toml','--target',$WindowsTarget,'--features','fault-injection','--example','windows_notifications') 'notification-driver-build.log'
    $NotificationDriver=Join-Path $RepoRoot "src-tauri/target/$WindowsTarget/debug/examples/windows_notifications.exe"
    if (-not (Test-Path -LiteralPath $NotificationDriver)) { throw 'Compiled FI notification driver missing.' }
    Run-Tool 'cargo' @('test','--manifest-path','src-tauri/Cargo.toml','--target',$WindowsTarget,'--features','fault-injection','--lib','installed_windows_identity_reconciles_system_schedule','--','--ignored','--test-threads=1','--nocapture') 'installed-notifications-test.log'
    if ((Get-Content (Join-Path $Output 'installed-notifications-test.log') -Raw) -notmatch '1 passed') { throw 'Installed notification test did not execute exactly one passing test.' }
    if ($null -ne $AppProcess) { throw 'Application must be closed before scheduled delivery acceptance.' }
    $appName=[IO.Path]::GetFileNameWithoutExtension($InstalledExe)
    $remaining=@(Get-Process -Name $appName -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $InstalledExe })
    if ($remaining.Count) { throw 'Installed app still running before delivery acceptance.' }
    $closedAt=(Get-Date).ToUniversalTime().ToString('o')
    $env:THINGARY_REMINDER_TEST_SECONDS='20'
    [void](Notify 'permission')
    $baseline=Notify 'clear'
    if (@($baseline.history).Count -ne 0 -or @($baseline.scheduled).Count -ne 0) { throw 'Fixture notification baseline is not empty.' }
    $queued=Notify 'reconcile'
    if (@($queued.scheduled).Count -ne 1) { throw 'Actual scheduled toast missing.' }
    $plan=@($queued.scheduled)[0]
    if ($plan.tag -ne $queued.fixture_tag -or $plan.group -ne $queued.fixture_group) { throw 'Queued fixture Group/Tag mismatch.' }
    if (@($queued.history).Count -ne 0) { throw 'Fixture history existed before the new scheduled delivery.' }
    $inspection=Notify 'inspect'
    if (@($inspection.scheduled).Count -ne 1) { throw 'Scheduled toast did not persist after driver exit.' }
    $retained=@($inspection.scheduled)[0]
    if ($retained.id -ne $plan.id -or $retained.tag -ne $plan.tag -or $retained.ticks -ne $plan.ticks) { throw 'Scheduled fixture changed between driver processes.' }
    $deliveryTime=[DateTime]::FromFileTimeUtc([long]$plan.ticks)
    $pollDeadline=(Get-Date).ToUniversalTime().AddSeconds(60)
    $delivered=$null
    while ((Get-Date).ToUniversalTime() -lt $pollDeadline) {
      $state=Notify 'inspect'
      $matching=@($state.history | Where-Object { $_.group -eq $plan.group -and $_.tag -eq $plan.tag })
      if ($matching.Count -gt 1) { throw 'Duplicate fixture history entries after scheduled delivery.' }
      if ($matching.Count -eq 1) {
        if ((Get-Date).ToUniversalTime() -lt $deliveryTime) { throw 'Fixture history appeared before its scheduled deadline.' }
        if ($matching[0].xml -notmatch '物谱隔离验收提醒' -or $matching[0].xml -notmatch 'thingary-windows-acceptance') { throw 'Delivered history content does not match the fictional fixture.' }
        if (@($state.scheduled | Where-Object { $_.group -eq $plan.group -and $_.tag -eq $plan.tag }).Count -ne 0) { throw 'Delivered fixture remains in the pending schedule.' }
        $delivered=$state
        break
      }
      Start-Sleep -Milliseconds 500
    }
    if ($null -eq $delivered) { throw 'Windows scheduled notification was not delivered into system history within 60 seconds.' }
    $delivered | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $Output 'notification-delivered.json') -Encoding utf8
    $Summary.notificationDelivery=@{ appClosedAt=$closedAt; scheduled=$plan; deadline=$deliveryTime.ToString('o'); observedAt=$delivered.observed_at; source='WinRT ToastNotificationManager.History.GetHistoryWithId'; history=$delivered.history; visibleDesktopToastVerified=$false }
    $cleared=Notify 'clear'
    if (@($cleared.scheduled).Count -ne 0 -or @($cleared.history).Count -ne 0) { throw 'Fixture scheduled/history notification was not cleared.' }
    $Summary.verified+=@('Windows actual AddToSchedule','same queue entry survives driver process exit','scheduled delivery into system history while application is closed','exact fixture Group/Tag history cleanup')
  } catch {
    $NotificationFailure=$_
    $Summary.notificationError=$_.Exception.ToString()
    Write-Warning "Notification acceptance failed; collecting independent UI evidence. $($Summary.notificationError)"
    try { [void](Notify 'clear') } catch { $Summary.notificationStageCleanupError=$_.Exception.ToString() }
  } finally {
    if ($env:THINGARY_REMINDER_TEST_SECONDS) { Remove-Item Env:THINGARY_REMINDER_TEST_SECONDS }
  }
  Start-Acceptance; UI 'smoke'; Stop-Acceptance
  Start-Acceptance; UI 'persistence' 'restart'
  $second=Start-Process -FilePath $InstalledExe -PassThru
  Wait-Condition { $second.Refresh(); $second.HasExited } 'second instance exit' 20
  $main=@(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($InstalledExe)) -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $InstalledExe })
  if ($main.Count -ne 1) { throw 'Installed app has duplicate primary processes.' }
  $Summary.verified+=@('single instance','UI save/cancel and restart persistence')
  Stop-Acceptance
  $before=Data-Hashes 'before-uninstall'; $before | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $Output 'before-uninstall-hashes.json') -Encoding utf8
  $uninstallers=@(Get-ChildItem -LiteralPath $InstalledDir -Filter '*uninstall*.exe')
  if ($uninstallers.Count -ne 1) { throw 'Installed uninstaller missing or ambiguous.' }
  $uninstall=Start-Process $uninstallers[0].FullName -ArgumentList '/S' -PassThru -Wait
  if ($uninstall.ExitCode -ne 0) { throw "Uninstall exit $($uninstall.ExitCode)" }
  Wait-Condition { -not (Test-Path -LiteralPath $InstalledExe) } 'silent uninstall' 30
  $after=Data-Hashes 'after-uninstall'
  if (($before | ConvertTo-Json -Compress) -ne ($after | ConvertTo-Json -Compress)) { throw 'Default uninstall changed/deleted acceptance data.' }
  Install-Acceptance; Start-Acceptance; UI 'persistence' 'reinstall'; Stop-Acceptance
  $Summary.verified+=@('default silent uninstall retains every data byte','same package reinstall opens persisted assets')
  # Exercise a saved business reminder through the running GUI and its real 60s timer.
  if ($null -eq $NotificationFailure) {
    try {
      $env:THINGARY_REMINDER_TEST_SECONDS='120'
      Start-Acceptance; UI 'business-reminder'
      $business=(Get-Content (Join-Path $Output 'ui-business-reminder-result.json') -Raw | ConvertFrom-Json).businessReminder
      $plan=$business.scheduled
      $deliveryTime=[DateTime]::FromFileTimeUtc([long]$plan.ticks)
      if ((Get-Date).ToUniversalTime() -ge $deliveryTime) { throw 'Business reminder deadline elapsed before clean app close.' }
      Stop-Acceptance
      $businessClosedAt=(Get-Date).ToUniversalTime()
      if ($businessClosedAt -ge $deliveryTime) { throw 'Business reminder app did not close before original deadline.' }
      $delivered=$null
      while ((Get-Date).ToUniversalTime() -lt $deliveryTime.AddSeconds(60)) {
        $state=Notify 'inspect'
        $matching=@($state.owned_history | Where-Object { $_.group -eq $plan.group -and $_.tag -eq $plan.tag })
        if ($matching.Count -gt 1) { throw 'Duplicate delivered business reminder.' }
        if ($matching.Count -eq 1) {
          if ((Get-Date).ToUniversalTime() -lt $deliveryTime -or $matching[0].xml -ne $plan.xml) { throw 'Business reminder history deadline/content mismatch.' }
          if (@($state.scheduled | Where-Object { $_.group -eq $plan.group -and $_.tag -eq $plan.tag }).Count) { throw 'Delivered business reminder remains scheduled.' }
          $delivered=$state; break
        }
        Start-Sleep -Milliseconds 500
      }
      if ($null -eq $delivered) { throw 'Saved business reminder did not reach system history after clean GUI exit.' }
      $delivered | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $Output 'business-notification-delivered.json') -Encoding utf8
      $Summary.businessNotificationDelivery=@{ saved=$business.saved; businessId=$business.businessId; scheduled=$plan; polls=$business.polls; appClosedAt=$businessClosedAt.ToString('o'); observedAt=$delivered.observed_at; visibleDesktopToastVerified=$false }
      $Summary.verified+=@('real saved wishlist reminder keeps deadline across GUI status poll','saved business reminder reaches system history after GUI exit')
      # Close immediately after the next real save; do not pre-inspect or wait for scheduling.
      Start-Acceptance; UI 'immediate-reminder'; Stop-Acceptance
      $immediate=(Get-Content (Join-Path $Output 'ui-immediate-reminder-result.json') -Raw | ConvertFrom-Json).businessReminder.saved
      $state=Notify 'inspect'
      $newPlan=@($state.scheduled | Where-Object { $_.group -eq 'thingary' -and $_.xml.Contains($immediate.name) })
      if ($newPlan.Count -ne 1) { throw 'Immediately saved business reminder is absent or duplicated after graceful exit.' }
      if ($newPlan[0].tag -ne $newPlan[0].id -or [DateTime]::FromFileTimeUtc([long]$newPlan[0].ticks) -le (Get-Date).ToUniversalTime()) { throw 'Immediately saved reminder identity/deadline invalid after exit.' }
      if (@($state.owned_history | Where-Object { $_.group -eq $newPlan[0].group -and $_.tag -eq $newPlan[0].tag }).Count) { throw 'New immediate reminder unexpectedly already in history.' }
      $state | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $Output 'immediate-exit-notification.json') -Encoding utf8
      $Summary.immediateExitNotification=@{ saved=$immediate; scheduled=$newPlan[0]; source='installed app save followed by graceful exit flush'; inspectedAfterExitAt=$state.observed_at; visibleDesktopToastVerified=$false }
      $Summary.verified+=@('immediate save then graceful exit retains business reminder in real system schedule')
    } finally {
      if ($null -ne $AppProcess) { Stop-Acceptance }
      Remove-Item Env:THINGARY_REMINDER_TEST_SECONDS -ErrorAction SilentlyContinue
    }
  }
  [void](Data-Hashes 'before-fixture-library-replacement')
  # Move only this run's fictional smoke library into artifacts; never follow reparse points.
  $library=Join-Path $DataRoot 'library'
  if ((Get-Item $DataRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Acceptance root is a link.' }
  if ((Get-Item $library).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Acceptance library is a link.' }
  $preserved=Join-Path $DataRoot 'acceptance-smoke-library'
  if (Test-Path $preserved) { throw 'Smoke preservation path already exists.' }
  # Keep rename on the app-data volume; hosted runners often use D: for workspace and C: for user data.
  Move-Item -LiteralPath $library -Destination $preserved
  Copy-Item -LiteralPath $preserved -Destination (Join-Path $Output 'smoke-library') -Recurse
  $Summary.preservedSmokeLibrary=$preserved
  Copy-Item -LiteralPath (Join-Path $restored 'fictional-library') -Destination $library -Recurse
  Start-Acceptance; UI 'fixture'; Stop-Acceptance
  $Summary.verified+=@('restored backup in installed UI','native window screenshot matrix')
  if ($null -ne $NotificationFailure) { throw $NotificationFailure }
  $Summary.status='passed'
} catch {
  $Summary.status='failed'; $Summary.error=$_.Exception.ToString(); Write-Warning $Summary.error
  throw
} finally {
  $cleanupFailure=$null
  if ($NotifyReady) { try { [void](Notify 'clear') } catch { $Summary.notificationCleanupError=$_.Exception.Message; $Summary.status='failed'; $cleanupFailure=$_.Exception } }
  if ($env:THINGARY_REMINDER_TEST_SECONDS) { Remove-Item Env:THINGARY_REMINDER_TEST_SECONDS }
  if ($null -ne $AppProcess) { try { Stop-Acceptance } catch { $Summary.forcedProcessCleanup=$_.Exception.Message; Stop-Process -Id $AppProcess.Id -Force -ErrorAction SilentlyContinue } }
  $Summary.finished=(Get-Date).ToUniversalTime().ToString('o'); Save-Summary
  if ($null -ne $cleanupFailure -and $null -eq $NotificationFailure) { throw $cleanupFailure }
}
