#requires -Version 5.1
<#
  Offline install of one DSH plugin (no network, no npm / pnpm).

  The archive next to this script carries the plugin and its runtime
  `node_modules`. The script puts the plugin under
  `<profile>/offline-plugins/<name>`, links it into `<profile>/node_modules`,
  and registers it in the profile manifest (dependency + `dsh.profile.bundles`).

  Usage:
    .\install-offline.ps1                      # profile "web" under $env:DSH_HOME
    .\install-offline.ps1 -Profile desktop     # the profile the Desktop serves
    .\install-offline.ps1 -Profile web -DshHome D:\dsh-home
    .\install-offline.ps1 -ProfileDir C:\Users\me\.dsh\profiles\web
#>
param(
  [string]$Profile = 'web',
  [string]$DshHome = '',
  [string]$ProfileDir = ''
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$packageDir = Join-Path $here 'package'
$packageManifest = Join-Path $packageDir 'package.json'
if (-not (Test-Path $packageManifest)) { throw "package/ is missing next to this script: $packageManifest" }
$package = Get-Content -Raw -Encoding UTF8 -Path $packageManifest | ConvertFrom-Json
$name = [string]$package.name
$version = [string]$package.version

if ($ProfileDir -eq '') {
  if ($DshHome -eq '') {
    $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
  }
  $ProfileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
}
$profileManifest = Join-Path $ProfileDir 'package.json'
if (-not (Test-Path $profileManifest)) {
  throw "Not a DSH profile (no package.json): $ProfileDir"
}

# 1. the plugin itself, next to the profile instead of inside a package store
$offlineRoot = Join-Path $ProfileDir 'offline-plugins'
$target = Join-Path $offlineRoot $name
if (Test-Path $target) { Remove-Item -Path $target -Recurse -Force }
New-Item -ItemType Directory -Path $offlineRoot -Force | Out-Null
Write-Host "[offline] copying $name@$version -> $target"
Copy-Item -Path $packageDir -Destination $target -Recurse -Force

# 2. node_modules entry: a junction on Windows (no admin rights needed)
$modules = Join-Path $ProfileDir 'node_modules'
New-Item -ItemType Directory -Path $modules -Force | Out-Null
$link = Join-Path $modules $name
if (Test-Path $link) { Remove-Item -Path $link -Recurse -Force }
New-Item -ItemType Junction -Path $link -Target $target | Out-Null

# 3. the profile manifest: a local dependency spec and the bundle entry
$json = Get-Content -Raw -Encoding UTF8 -Path $profileManifest | ConvertFrom-Json
if (-not $json.PSObject.Properties['dependencies']) {
  $json | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{})
}
$json.dependencies | Add-Member -NotePropertyName $name -NotePropertyValue "file:./offline-plugins/$name" -Force
if (-not $json.PSObject.Properties['dsh']) {
  $json | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{})
}
if (-not $json.dsh.PSObject.Properties['profile']) {
  $json.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{})
}
$bundles = @()
if ($json.dsh.profile.PSObject.Properties['bundles'] -and $null -ne $json.dsh.profile.bundles) {
  $bundles = @($json.dsh.profile.bundles)
}
if ($bundles -notcontains $name) { $bundles += $name }
$json.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue $bundles -Force
# No BOM: JSON.parse (and pnpm) reject a profile manifest that starts with one.
$text = ($json | ConvertTo-Json -Depth 32) + "`n"
[System.IO.File]::WriteAllText($profileManifest, $text, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "[offline] registered $name in $profileManifest"
Write-Host "[offline] done. Restart the '$Profile' profile (quit and reopen DSH Desktop if it owns the profile)."
