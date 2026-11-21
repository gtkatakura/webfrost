# WebFrost installer for Windows (PowerShell 5.1 or newer):
#
#   irm https://webfrost.dev/install.ps1 | iex
#
# Downloads webfrost.exe from the latest GitHub release, checks its SHA-256 against the
# release's checksums.txt (and stops if it does not match), and puts it in
# %LOCALAPPDATA%\Programs\webfrost\bin. No administrator rights needed.
#
# Environment variables:
#   WEBFROST_VERSION        version to install, for example 1.2.3 (default: the latest release)
#   WEBFROST_INSTALL_DIR    where to put webfrost.exe (default: %LOCALAPPDATA%\Programs\webfrost\bin)
#   WEBFROST_DOWNLOAD_BASE  URL that holds the archives and checksums.txt, instead of the
#                           GitHub release. For testing and for mirrors.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  # Windows PowerShell 5.1 defaults to old TLS versions that GitHub refuses.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $repo = 'gtkatakura/webfrost'

  function Fail([string]$message) {
    Write-Host "install.ps1: error: $message" -ForegroundColor Red
    throw $message
  }

  # The only Windows build is x64 (it also runs on Windows on ARM, through emulation).
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  if ($arch -ne 'X64' -and $arch -ne 'Arm64') { Fail "unsupported CPU architecture: $arch. WebFrost has a Windows build for x64." }

  $archive = 'webfrost-windows-x64.zip'

  if ($env:WEBFROST_DOWNLOAD_BASE) {
    $base = $env:WEBFROST_DOWNLOAD_BASE.TrimEnd('/')
  } elseif ($env:WEBFROST_VERSION) {
    $base = "https://github.com/$repo/releases/download/v$($env:WEBFROST_VERSION.TrimStart('v'))"
  } else {
    $base = "https://github.com/$repo/releases/latest/download"
  }

  if ($env:WEBFROST_INSTALL_DIR) {
    $installDir = $env:WEBFROST_INSTALL_DIR
  } else {
    $installDir = Join-Path $env:LOCALAPPDATA 'Programs\webfrost\bin'
  }

  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("webfrost-" + [System.Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    Write-Host "Installing webfrost (windows-x64) from $base"

    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$base/$archive" -OutFile (Join-Path $tmp $archive)
    } catch {
      Fail "cannot download $base/$archive ($($_.Exception.Message))"
    }
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$base/checksums.txt" -OutFile (Join-Path $tmp 'checksums.txt')
    } catch {
      Fail "cannot download $base/checksums.txt, so the download cannot be verified"
    }

    # checksums.txt lines look like: <sha256>  <file name>
    $expected = $null
    foreach ($line in Get-Content (Join-Path $tmp 'checksums.txt')) {
      $parts = $line.Trim() -split '\s+', 2
      if ($parts.Length -eq 2 -and $parts[1].TrimStart('*') -eq $archive) { $expected = $parts[0].ToLowerInvariant(); break }
    }
    if (-not $expected) { Fail "checksums.txt has no entry for $archive" }
    $actual = (Get-FileHash -Algorithm SHA256 -Path (Join-Path $tmp $archive)).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
      Write-Host "install.ps1: error: checksum mismatch for $archive" -ForegroundColor Red
      Write-Host "  expected: $expected"
      Write-Host "  actual:   $actual"
      Fail 'the download is corrupt or has been tampered with; nothing was installed'
    }
    Write-Host "Checksum verified (sha256 $actual)"

    $extract = Join-Path $tmp 'extract'
    Expand-Archive -Path (Join-Path $tmp $archive) -DestinationPath $extract -Force
    $exe = Join-Path $extract 'webfrost.exe'
    if (-not (Test-Path $exe)) { Fail "$archive does not contain webfrost.exe" }

    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    $target = Join-Path $installDir 'webfrost.exe'
    try {
      Copy-Item -Path $exe -Destination $target -Force
    } catch {
      Fail "cannot write $target ($($_.Exception.Message)). Is webfrost running? Set WEBFROST_INSTALL_DIR to use another directory."
    }

    $versionOutput = & $target --version 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "the installed binary does not run: $versionOutput" }
    Write-Host "Installed $versionOutput to $target"

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $onPath = ($env:Path -split ';') + ($userPath -split ';') | Where-Object { $_.TrimEnd('\') -eq $installDir.TrimEnd('\') }
    if (-not $onPath) {
      Write-Host ''
      Write-Host "$installDir is not on your PATH. Add it for your user with:"
      Write-Host "  [Environment]::SetEnvironmentVariable('Path', `"$installDir;`" + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')"
      Write-Host 'then open a new terminal.'
    }

    Write-Host ''
    Write-Host 'Next:'
    Write-Host '  webfrost setup     # a headless Chromium, if you have none'
    Write-Host '  webfrost serve     # server, web UI and scheduler on :3000'
  } finally {
    Remove-Item -Recurse -Force -Path $tmp -ErrorAction SilentlyContinue
  }
}
