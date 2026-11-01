param(
  [string]$NodeExe = "",
  [string]$Version = "0.0.7"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not $NodeExe) {
  $NodeExe = (Get-Command node).Source
}
if (-not (Test-Path $NodeExe)) {
  throw "node.exe not found. Pass -NodeExe <path>."
}

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
  throw "csc.exe not found: $csc"
}

$build = Join-Path $root ".artifacts\build"
$payload = Join-Path $build "payload"
Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $payload -Force | Out-Null

Copy-Item bin, src, public -Destination $payload -Recurse
Copy-Item server.js, package.json, README.md, LICENSE, kanmod.cmd -Destination $payload
Copy-Item $NodeExe (Join-Path $payload "node.exe")
$nodeLicense = Join-Path (Split-Path $NodeExe -Parent) "license.rtf"
if (Test-Path $nodeLicense) {
  Copy-Item $nodeLicense (Join-Path $payload "node-license.rtf")
}

$launcher = Join-Path $build "kanmod.exe"
$icon = Join-Path $PSScriptRoot "kanmod.ico"
& $csc /nologo /target:winexe /codepage:65001 "/out:$launcher" "/win32icon:$icon" `
  /reference:System.dll /reference:System.Core.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
  (Join-Path $PSScriptRoot "KanmodLauncher.cs")
if ($LASTEXITCODE -ne 0) { throw "launcher compile failed" }
Copy-Item $launcher (Join-Path $payload "kanmod.exe")

$uninstaller = Join-Path $build "uninstall.exe"
& $csc /nologo /target:winexe /codepage:65001 "/out:$uninstaller" "/win32icon:$icon" `
  /reference:System.dll /reference:System.Core.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
  (Join-Path $PSScriptRoot "KanmodUninstaller.cs")
if ($LASTEXITCODE -ne 0) { throw "uninstaller compile failed" }
Copy-Item $uninstaller (Join-Path $payload "uninstall.exe")

$updater = Join-Path $build "kanmod-update.exe"
& $csc /nologo /target:winexe /codepage:65001 "/out:$updater" "/win32icon:$icon" `
  /reference:System.dll /reference:System.Core.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll `
  (Join-Path $PSScriptRoot "KanmodUpdater.cs")
if ($LASTEXITCODE -ne 0) { throw "updater compile failed" }
Copy-Item $updater (Join-Path $payload "kanmod-update.exe")

$zip = Join-Path $build "payload.zip"
Compress-Archive -Path (Join-Path $payload "*") -DestinationPath $zip -CompressionLevel Optimal

$setup = Join-Path $build "kanmod-setup-$Version.exe"
& $csc /nologo /target:winexe /codepage:65001 "/out:$setup" "/win32icon:$icon" `
  /reference:System.dll /reference:System.Core.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
  /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:Microsoft.CSharp.dll `
  "/resource:$zip,payload.zip" (Join-Path $PSScriptRoot "KanmodSetup.cs")
if ($LASTEXITCODE -ne 0) { throw "setup compile failed" }

Write-Host "Built: $setup"
Get-Item $setup | Select-Object FullName, Length
