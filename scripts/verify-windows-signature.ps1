param(
  [Parameter(Mandatory = $true)][string]$Payload,
  [Parameter(Mandatory = $true)][string]$Installer,
  [ValidateSet('Unsigned', 'Signed')][string]$Expected = 'Unsigned',
  [string]$ExpectedSubjectContains = '',
  [switch]$RequireTimestamp
)

$ErrorActionPreference = 'Stop'

$files = @(
  @{ Name = 'payload'; Path = $Payload },
  @{ Name = 'installer'; Path = $Installer }
)

foreach ($file in $files) {
  if (-not (Test-Path -LiteralPath $file.Path -PathType Leaf)) {
    throw "Missing $($file.Name): $($file.Path)"
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $file.Path
  $subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }

  if ($Expected -eq 'Unsigned') {
    if ($signature.Status -ne 'NotSigned') {
      throw "Expected unsigned $($file.Name), got $($signature.Status): $($file.Path)"
    }
    Write-Host "Unsigned OK: $($file.Name) ($($file.Path))"
    continue
  }

  if ($signature.Status -ne 'Valid') {
    throw "Expected a valid signature on $($file.Name), got $($signature.Status): $($file.Path)"
  }
  if (-not $signature.SignerCertificate) {
    throw "Signature has no signer certificate: $($file.Name) ($($file.Path))"
  }
  if ($ExpectedSubjectContains -and $subject -notlike "*$ExpectedSubjectContains*") {
    throw "Unexpected signer for $($file.Name): $subject"
  }
  if ($RequireTimestamp -and -not $signature.TimeStamperCertificate) {
    throw "Signature has no timestamp: $($file.Name) ($($file.Path))"
  }

  Write-Host "Signed OK: $($file.Name) - $subject"
  if ($signature.TimeStamperCertificate) {
    Write-Host "Timestamp: $($signature.TimeStamperCertificate.Subject)"
  }
}
