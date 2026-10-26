#Requires -Version 7.0
<#
.SYNOPSIS
  Stage an unsigned x64 MSIX for Microsoft Store submission and validate it
  with MakeAppx.exe. Never signs, installs or launches the application.

.DESCRIPTION
  The NSIS flow is unchanged: this script only reads the release payload that
  `tauri build --no-bundle` already produced. The package identity defaults to
  the reserved Partner Center product and can be overridden with
  PARTNER_CENTER_IDENTITY_NAME, PARTNER_CENTER_PUBLISHER and
  PARTNER_CENTER_PUBLISHER_DISPLAY_NAME. An override that is present but empty
  is an error instead of a guessed value.

  The Microsoft Store re-signs the uploaded package, so the artifact is
  deliberately unsigned. WebView2 is not installed at runtime by an MSIX; the
  manifest therefore targets Windows 11 (10.0.22000.0) only. See
  docs/RELEASING.md#microsoft-store for the support boundary and the checks
  that still require a real Windows 11 device.

.PARAMETER OutputDir
  Artifact directory, default .local/msix. Must stay inside the repository.

.PARAMETER NoticesDir
  Output of `node scripts/prepare-windows.mjs --packaging msix --output ...`,
  default .local/distribution/msix-notices.

.PARAMETER PayloadDir
  Directory containing thingary.exe, default
  src-tauri/target/x86_64-pc-windows-msvc/release.
#>
[CmdletBinding()]
param(
  [string]$OutputDir,
  [string]$NoticesDir,
  [string]$PayloadDir,
  [string]$IdentityName,
  [string]$Publisher,
  [string]$PublisherDisplayName,
  [string]$Configuration = 'release'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $root 'package.json'))) {
  throw "pack-msix.ps1 must live in the repository's scripts directory."
}

function Resolve-RepoPath([string]$Path, [string]$Default) {
  $value = if ($Path) { $Path } else { $Default }
  if ([System.IO.Path]::IsPathRooted($value)) { return [System.IO.Path]::GetFullPath($value) }
  return [System.IO.Path]::GetFullPath((Join-Path $root $value))
}

function Assert-InRepo([string]$Path, [string]$Label) {
  $full = [System.IO.Path]::GetFullPath($Path)
  $prefix = [System.IO.Path]::GetFullPath($root) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label must stay inside the repository: $full"
  }
}

function Resolve-Setting([string]$Explicit, [string]$Variable, [string]$Default, [string]$Label) {
  if ($Explicit) {
    return [pscustomobject]@{ Value = $Explicit.Trim(); Source = 'parameter' }
  }
  if (Test-Path "Env:$Variable") {
    $value = [Environment]::GetEnvironmentVariable($Variable)
    if ([string]::IsNullOrWhiteSpace($value)) {
      throw "$Variable is set but empty; refusing to guess $Label. Unset it to use the reserved Partner Center default."
    }
    return [pscustomobject]@{ Value = $value.Trim(); Source = $Variable }
  }
  return [pscustomobject]@{ Value = $Default; Source = 'reserved Partner Center product' }
}

function Get-FileHashes([string]$Directory) {
  $items = Get-ChildItem -LiteralPath $Directory -Recurse -File | ForEach-Object {
    [pscustomobject]@{
      Path = [System.IO.Path]::GetRelativePath($Directory, $_.FullName).Replace('\', '/')
      Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
  }
  return @($items | Sort-Object -Property Path)
}

$defaultIdentity = 'CoderJackZhu.3513028683F74'
$defaultPublisher = 'CN=BE6E0613-B500-4B85-B8F0-44A3FA29EB8C'
$defaultPublisherDisplay = 'CoderJackZhu'
$expectedFamilyName = 'CoderJackZhu.3513028683F74_0yc8cf5cay4hg'
$storeId = '9N0Z2JF21D6D'
$minimumWindows = [version]'10.0.22000.0'

$identity = Resolve-Setting -Explicit $IdentityName -Variable 'PARTNER_CENTER_IDENTITY_NAME' -Default $defaultIdentity -Label 'the package identity name'
$publisherSetting = Resolve-Setting -Explicit $Publisher -Variable 'PARTNER_CENTER_PUBLISHER' -Default $defaultPublisher -Label 'the package publisher'
$publisherDisplay = Resolve-Setting -Explicit $PublisherDisplayName -Variable 'PARTNER_CENTER_PUBLISHER_DISPLAY_NAME' -Default $defaultPublisherDisplay -Label 'the publisher display name'

if ($identity.Value -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*$') {
  throw "Invalid package identity name: '$($identity.Value)'. Use the exact Partner Center identity."
}
if ($publisherSetting.Value -notmatch '^CN=[^,]+$') {
  throw "Invalid publisher: '$($publisherSetting.Value)'. Expected a single CN=<value> string from Partner Center."
}
if ([string]::IsNullOrWhiteSpace($publisherDisplay.Value)) {
  throw 'The publisher display name must not be empty.'
}

$packageJson = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = [string]$packageJson.version
if ($version -notmatch '^\d+\.\d+\.\d+$') {
  throw "package.json version '$version' cannot map to a Store four-part version; expected X.Y.Z."
}
$msixVersion = "$version.0"
$tauriConfig = Get-Content -LiteralPath (Join-Path $root 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
if ([string]$tauriConfig.version -ne $version) {
  throw "src-tauri/tauri.conf.json version does not match package.json ($version)."
}
$cargo = Get-Content -LiteralPath (Join-Path $root 'src-tauri/Cargo.toml') -Raw
if ($cargo -notmatch ('(?m)^version\s*=\s*"' + [regex]::Escape($version) + '"')) {
  throw "src-tauri/Cargo.toml version does not match package.json ($version)."
}

$payload = Resolve-RepoPath $PayloadDir "src-tauri/target/x86_64-pc-windows-msvc/$Configuration"
$notices = Resolve-RepoPath $NoticesDir '.local/distribution/msix-notices'
$output = Resolve-RepoPath $OutputDir '.local/msix'
Assert-InRepo $payload 'PayloadDir'
Assert-InRepo $notices 'NoticesDir'
Assert-InRepo $output 'OutputDir'

$exePath = Join-Path $payload 'thingary.exe'
if (-not (Test-Path -LiteralPath $exePath)) {
  throw "Missing $exePath. Build the release payload on Windows first (tauri build --no-bundle --target x86_64-pc-windows-msvc)."
}
$buildInfoPath = Join-Path $notices 'BUILD_INFO.json'
if (-not (Test-Path -LiteralPath $buildInfoPath)) {
  throw "Missing $buildInfoPath. Run: node scripts/prepare-windows.mjs --identity local.thingary.main --output $notices --packaging msix"
}

$work = Join-Path $root '.local/msix-work'
if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
$stage = Join-Path $work 'payload'
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Copy-Item -LiteralPath $exePath -Destination (Join-Path $stage 'thingary.exe')
Get-ChildItem -LiteralPath $payload -Filter '*.dll' -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $stage
}

$licenseDir = Join-Path $stage '许可'
New-Item -ItemType Directory -Path $licenseDir -Force | Out-Null
Copy-Item -Path (Join-Path $notices '*') -Destination $licenseDir -Recurse -Force
foreach ($name in @('LICENSE', 'THIRD_PARTY_LICENSES.md', 'SOURCE_NOTICES.md', 'THIRD_PARTY_NOTICES.txt', 'license-inventory.json', '许可与源码.txt', 'BUILD_INFO.json')) {
  if (-not (Test-Path -LiteralPath (Join-Path $licenseDir $name))) {
    throw "The MSIX notices are missing $name. Re-run prepare-windows.mjs with --packaging msix."
  }
}

$head = (& git -C $root rev-parse HEAD | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$') {
  throw 'git rev-parse HEAD failed; an MSIX must carry a source commit.'
}
$buildInfo = Get-Content -LiteralPath (Join-Path $licenseDir 'BUILD_INFO.json') -Raw | ConvertFrom-Json
if ([string]$buildInfo.source_commit -ne $head) {
  throw "BUILD_INFO.json is from $($buildInfo.source_commit), not the checked-out commit $head."
}
if ([string]$buildInfo.packaging -ne 'msix') {
  throw "BUILD_INFO.json was not prepared for MSIX. Re-run prepare-windows.mjs with --packaging msix."
}
if ([string]$buildInfo.signing_status -ne 'unsigned') {
  throw 'The Store MSIX artifact must be unsigned.'
}
if ([string]$buildInfo.identity -ne 'local.thingary.main') {
  throw "The MSIX notice identity must be local.thingary.main, got '$($buildInfo.identity)'."
}
if ([string]$buildInfo.version -ne $version) {
  throw "BUILD_INFO.json version does not match package.json ($version)."
}
$noticesHash = (Get-FileHash -LiteralPath (Join-Path $licenseDir 'THIRD_PARTY_NOTICES.txt') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($noticesHash -ne [string]$buildInfo.third_party_notices_sha256) {
  throw 'The packaged third-party notices differ from the hash in BUILD_INFO.json.'
}

try {
  Add-Type -AssemblyName System.Drawing -ErrorAction Stop
} catch {
  Add-Type -AssemblyName System.Drawing.Common -ErrorAction Stop
}
$iconPath = Join-Path $root 'src-tauri/icons/icon.png'
if (-not (Test-Path -LiteralPath $iconPath)) { throw "Missing application icon: $iconPath" }
$assetsDir = Join-Path $stage 'Assets'
New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null
$sourceImage = [System.Drawing.Image]::FromFile($iconPath)
try {
  foreach ($asset in @(
    @{ Name = 'Square44x44Logo.png'; Size = 44 },
    @{ Name = 'Square44x44Logo.scale-200.png'; Size = 88 },
    @{ Name = 'Square150x150Logo.png'; Size = 150 },
    @{ Name = 'Square150x150Logo.scale-200.png'; Size = 300 },
    @{ Name = 'StoreLogo.png'; Size = 50 },
    @{ Name = 'StoreLogo.scale-200.png'; Size = 100 }
  )) {
    $size = [int]$asset.Size
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.DrawImage($sourceImage, 0, 0, $size, $size)
      } finally {
        $graphics.Dispose()
      }
      $bitmap.Save((Join-Path $assetsDir $asset.Name), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $bitmap.Dispose()
    }
  }
} finally {
  $sourceImage.Dispose()
}

$templatePath = Join-Path $root 'packaging/msix/Package.appxmanifest'
$manifestText = [System.IO.File]::ReadAllText($templatePath)
$manifestText = $manifestText.Replace('__IDENTITY_NAME__', $identity.Value)
# Replace the longer publisher token first: __PUBLISHER__ is a prefix of it.
$manifestText = $manifestText.Replace('__PUBLISHER_DISPLAY_NAME__', $publisherDisplay.Value)
$manifestText = $manifestText.Replace('__PUBLISHER__', $publisherSetting.Value)
$manifestText = $manifestText.Replace('__VERSION__', $msixVersion)
$manifestText = $manifestText.Replace('__ARCHITECTURE__', 'x64')
if ($manifestText -match '__[A-Z0-9_]+__') {
  throw "Unresolved manifest placeholder: $($Matches[0])"
}
$manifestPath = Join-Path $stage 'AppxManifest.xml'
[System.IO.File]::WriteAllText($manifestPath, $manifestText, [System.Text.UTF8Encoding]::new($false))

[xml]$manifest = [System.IO.File]::ReadAllText($manifestPath)
$identityNode = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Identity']")
if ($null -eq $identityNode) { throw 'The manifest has no Identity element.' }
if ($identityNode.GetAttribute('Name') -ne $identity.Value) { throw 'Identity Name substitution failed.' }
if ($identityNode.GetAttribute('Publisher') -ne $publisherSetting.Value) { throw 'Publisher substitution failed.' }
if ($identityNode.GetAttribute('Version') -ne $msixVersion) { throw 'Version substitution failed.' }
if ($identityNode.GetAttribute('ProcessorArchitecture') -ne 'x64') { throw 'ProcessorArchitecture must be x64.' }
$deviceFamily = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Dependencies']/*[local-name()='TargetDeviceFamily']")
if ($null -eq $deviceFamily) { throw 'The manifest has no TargetDeviceFamily.' }
if ($deviceFamily.GetAttribute('Name') -ne 'Windows.Desktop') { throw 'TargetDeviceFamily must be Windows.Desktop.' }
$minVersionText = $deviceFamily.GetAttribute('MinVersion')
$maxVersionText = $deviceFamily.GetAttribute('MaxVersionTested')
if ([version]$minVersionText -lt $minimumWindows) {
  throw "MinVersion must stay at or above $minimumWindows because an MSIX cannot install WebView2 at runtime."
}
if ([version]$maxVersionText -lt [version]$minVersionText) {
  throw 'MaxVersionTested is lower than MinVersion.'
}
$application = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Applications']/*[local-name()='Application']")
if ($null -eq $application) { throw 'The manifest has no Application.' }
if ($application.GetAttribute('Executable') -ne 'thingary.exe') { throw 'The application executable must be thingary.exe.' }
if ($application.GetAttribute('EntryPoint') -ne 'Windows.FullTrustApplication') { throw 'EntryPoint must be Windows.FullTrustApplication.' }
$runFullTrust = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Capabilities']/*[local-name()='Capability'][@Name='runFullTrust']")
if ($null -eq $runFullTrust) { throw 'The runFullTrust capability is required for the desktop payload.' }
$unvirtualized = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Capabilities']/*[local-name()='Capability'][@Name='unvirtualizedResources']")
if ($null -eq $unvirtualized) { throw 'The unvirtualizedResources capability is required to turn file-system write virtualization off.' }
$virtualization = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Properties']/*[local-name()='FileSystemWriteVirtualization']")
if ($null -eq $virtualization -or $virtualization.InnerText -ne 'disabled') { throw 'FileSystemWriteVirtualization must be disabled so uninstalling the package keeps the library.' }
$visual = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Applications']/*[local-name()='Application']/*[local-name()='VisualElements']")
if ($null -eq $visual) { throw 'The manifest has no VisualElements.' }
$logoNode = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Properties']/*[local-name()='Logo']")
if ($null -eq $logoNode) { throw 'The manifest has no Properties/Logo.' }
$logoPaths = @(
  $logoNode.InnerText,
  $visual.GetAttribute('Square150x150Logo'),
  $visual.GetAttribute('Square44x44Logo')
)
foreach ($logo in $logoPaths) {
  if ([string]::IsNullOrWhiteSpace($logo)) { throw 'A manifest logo path is empty.' }
  $relative = $logo.Replace('\', '/')
  if (-not (Test-Path -LiteralPath (Join-Path $stage $relative))) {
    throw "Manifest logo is missing from the payload: $logo"
  }
}

$makeappx = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) {
  $command = Get-Command makeappx.exe -ErrorAction SilentlyContinue
  if ($command) { $makeappx = Get-Item $command.Source }
}
if (-not $makeappx) {
  throw 'MakeAppx.exe was not found. Install the Windows SDK (MakeAppx is part of the desktop packaging tools).'
}

New-Item -ItemType Directory -Path $output -Force | Out-Null
$msixName = "Thingary_${version}_x64.msix"
$msixPath = Join-Path $output $msixName
# Keep one versioned artifact in the output so an artifact upload cannot pick up
# a stale build from an earlier version. Only our own naming pattern is removed.
Get-ChildItem -LiteralPath $output -Filter 'Thingary_*_x64.msix' -File |
  Where-Object { $_.Name -ne $msixName } |
  Remove-Item -Force
& $makeappx.FullName pack /d $stage /p $msixPath /o
if ($LASTEXITCODE -ne 0) { throw "MakeAppx pack failed with exit code $LASTEXITCODE." }

$unpacked = Join-Path $work 'unpacked'
New-Item -ItemType Directory -Path $unpacked -Force | Out-Null
& $makeappx.FullName unpack /p $msixPath /d $unpacked /o
if ($LASTEXITCODE -ne 0) { throw "MakeAppx unpack failed with exit code $LASTEXITCODE." }

if (Test-Path -LiteralPath (Join-Path $unpacked 'AppxSignature.p7x')) {
  throw 'The Store candidate must be unsigned; MakeAppx produced a signature block.'
}
$packedManifestPath = Join-Path $unpacked 'AppxManifest.xml'
if (-not (Test-Path -LiteralPath $packedManifestPath)) {
  throw 'The packed MSIX has no AppxManifest.xml.'
}
# MakeAppx may normalize the manifest container file, so it is validated as XML
# below rather than compared byte-for-byte like the payload.
$stagedHashes = @(Get-FileHashes $stage | Where-Object { $_.Path -ne 'AppxManifest.xml' })
$packedHashes = @(Get-FileHashes $unpacked | Where-Object { $_.Path -ne 'AppxManifest.xml' })
$generated = @('AppxBlockMap.xml', '[Content_Types].xml', 'AppxSignature.p7x', 'resources.pri')
$stagedIndex = @{}
foreach ($item in $stagedHashes) { $stagedIndex[$item.Path] = $item.Hash }
foreach ($item in $packedHashes) {
  if ($generated -contains $item.Path -or $item.Path.StartsWith('AppxMetadata/')) { continue }
  if (-not $stagedIndex.ContainsKey($item.Path)) {
    throw "Unexpected file in the packed MSIX: $($item.Path)"
  }
  if ($stagedIndex[$item.Path] -ne $item.Hash) {
    throw "Packed file differs from the staged payload: $($item.Path)"
  }
  $stagedIndex.Remove($item.Path)
}
if ($stagedIndex.Count -gt 0) {
  throw "The packed MSIX is missing: $($stagedIndex.Keys -join ', ')"
}

[xml]$packedManifest = [System.IO.File]::ReadAllText($packedManifestPath)
$packedIdentity = $packedManifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Identity']")
if ($null -eq $packedIdentity) { throw 'The packed manifest has no Identity element.' }
if ($packedIdentity.GetAttribute('Name') -ne $identity.Value) { throw 'The packed Identity Name differs from the staged manifest.' }
if ($packedIdentity.GetAttribute('Publisher') -ne $publisherSetting.Value) { throw 'The packed Publisher differs from the staged manifest.' }
if ($packedIdentity.GetAttribute('Version') -ne $msixVersion) { throw 'The packed Version differs from the staged manifest.' }
if ($packedIdentity.GetAttribute('ProcessorArchitecture') -ne 'x64') { throw 'The packed ProcessorArchitecture must be x64.' }

$exeBytes = [System.IO.File]::ReadAllBytes((Join-Path $unpacked 'thingary.exe'))
if ([System.Text.Encoding]::ASCII.GetString($exeBytes, 0, 2) -ne 'MZ') { throw 'The packaged payload is not a PE file.' }
$peOffset = [System.BitConverter]::ToInt32($exeBytes, 0x3c)
if ([System.BitConverter]::ToUInt32($exeBytes, $peOffset) -ne 0x00004550) { throw 'The packaged payload has no PE header.' }
if ([System.BitConverter]::ToUInt16($exeBytes, $peOffset + 4) -ne 0x8664) { throw 'The packaged payload must be Windows x64.' }
$productVersion = (Get-Item -LiteralPath (Join-Path $unpacked 'thingary.exe')).VersionInfo.ProductVersion
if ($productVersion -ne $version) { throw "The packaged payload version is '$productVersion', not '$version'." }

$dataFiles = Get-ChildItem -LiteralPath $unpacked -Recurse -File | Where-Object {
  $_.Extension -in @('.thingary', '.db', '.sqlite', '.sqlite3', '.age') -or $_.Name -like '*.thingary.age'
}
if ($dataFiles) {
  throw "The MSIX must not contain user data or fixtures: $($dataFiles.Name -join ', ')"
}

$sha = (Get-FileHash -LiteralPath $msixPath -Algorithm SHA256).Hash.ToLowerInvariant()
$packageFamilyName = $null
$familyNote = $null
if ($identity.Value -eq $defaultIdentity -and $publisherSetting.Value -eq $defaultPublisher) {
  $packageFamilyName = $expectedFamilyName
} else {
  $familyNote = 'Identity override in use; the family name in the docs belongs to the reserved product.'
}
$minimumVersion = $minVersionText
$maxVersionTested = $maxVersionText
$summary = [ordered]@{
  package = $msixName
  sha256 = $sha
  byte_size = (Get-Item -LiteralPath $msixPath).Length
  identity_name = $identity.Value
  identity_source = $identity.Source
  publisher = $publisherSetting.Value
  publisher_source = $publisherSetting.Source
  publisher_display_name = $publisherDisplay.Value
  version = $msixVersion
  architecture = 'x64'
  target_device_family = 'Windows.Desktop'
  minimum_windows_version = $minimumVersion
  max_version_tested = $maxVersionTested
  package_family_name = $packageFamilyName
  package_family_name_note = $familyNote
  store_id = $storeId
  signing_status = 'unsigned'
  signing_note = 'The Microsoft Store re-signs the uploaded package after certification; no certificate or private key is part of this artifact.'
  run_full_trust = $true
  source_commit = $head
  payload_file_count = $stagedHashes.Count
  payload_files = @($stagedHashes | ForEach-Object { [ordered]@{ path = $_.Path; sha256 = $_.Hash.ToLowerInvariant() } })
  static_validation = $true
}
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'msix-verification.json') -Encoding utf8
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $output 'AppxManifest.xml') -Force
"$sha  $msixName" | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding ascii

Write-Host "MSIX OK: $msixPath"
Write-Host "SHA-256: $sha"
Write-Host "Identity: $($identity.Value) / $($publisherSetting.Value)"
Write-Host "Version: $msixVersion  Windows: $minimumVersion+"
if ($packageFamilyName) { Write-Host "Package family name: $packageFamilyName" }
