# build.ps1 - check the Notification Center, build a clean bundle, optionally install it.
#
#   pwsh -File build.ps1                          # check + pack
#   pwsh -File build.ps1 -Install                 # check + pack + install on the TV
#   pwsh -File build.ps1 -Install -TvIp 192.168.1.7,192.168.1.3
#
# The Vetro packer is vendored in tools/vetro/ (MIT, see tools/vetro/LICENSE) so the build
# never depends on a clone in %TEMP%. Staging lives in build/stage and is gitignored; never
# pack the project folder itself (dist/ would then be embedded in the .vplugin).

param(
    [switch]$Install,
    [string[]]$TvIp = @("192.168.1.7")
)

$ErrorActionPreference = "Stop"
$TvIp = @($TvIp | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$root = $PSScriptRoot
$stage = Join-Path $root "build\stage"
$dist = Join-Path $root "dist"
$packer = Join-Path $root "tools\vetro\scripts\vetro-plugin.cjs"

function Fail($message) { Write-Error $message; exit 1 }

Write-Host "== Notification Center drift check"
foreach ($ip in $TvIp) {
    & (Join-Path $root "check-nc.ps1") -Tv "${ip}:8099"
    if ($LASTEXITCODE -ne 0) { Fail "Notification Center changed or unreachable on $ip; fix that before packing." }
}

Write-Host "== Clean staging"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $stage "providers") | Out-Null
foreach ($f in @("index.js", "ui.html", "manifest.json", "README.md", "LICENSE", "news.js")) {
    Copy-Item (Join-Path $root $f) (Join-Path $stage $f)
}
foreach ($f in @("espn.js", "af.js")) {
    Copy-Item (Join-Path $root "providers\$f") (Join-Path $stage "providers\$f")
}

Write-Host "== Vetro check"
& node $packer check $stage
if ($LASTEXITCODE -ne 0) { Fail "Vetro check failed." }

Write-Host "== Vetro pack"
& node $packer pack $stage $dist
if ($LASTEXITCODE -ne 0) { Fail "Vetro pack failed." }

$version = (Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json).version
foreach ($doc in @("AGENTS.md", "README.md", "MELHORIAS.md", "package.json")) {
    $text = Get-Content (Join-Path $root $doc) -Raw
    if ($text.IndexOf($version) -lt 0) { Fail "$doc does not mention version $version; update the docs before packing." }
}
$bundle = Join-Path $dist "match-alerts-$version.vplugin"
if (-not (Test-Path $bundle)) { Fail "Bundle not found: $bundle" }
$sha = (Get-FileHash $bundle -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "Bundle: $bundle"
Write-Host "sha256: $sha"

# dist/ is gitignored, but old bundles still pile up on disk. Keep the current one and its predecessor.
$old = Get-ChildItem $dist -Filter "match-alerts-*.vplugin" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 2
foreach ($f in $old) { Remove-Item $f.FullName -Force; Write-Host "Removed old bundle: $($f.Name)" }

if ($Install) {
    foreach ($ip in $TvIp) {
        $base = "http://${ip}:8099"
        Write-Host "== Install on $ip"
        $null = Invoke-WebRequest -Uri "$base/plugins/match-alerts/disable" -Method POST -UseBasicParsing -TimeoutSec 20
        $r = Invoke-WebRequest -Uri "$base/plugins/install" -Method POST -InFile $bundle -ContentType "application/octet-stream" -Headers @{ "X-Vetro-Sha256" = $sha } -UseBasicParsing -TimeoutSec 60
        $answer = $r.Content | ConvertFrom-Json
        if (-not $answer.ok) { Fail "Install failed on $ip`: $($r.Content)" }
        $null = Invoke-WebRequest -Uri "$base/plugins/match-alerts/enable" -Method POST -UseBasicParsing -TimeoutSec 20
        $list = (Invoke-WebRequest -Uri "$base/plugins" -UseBasicParsing -TimeoutSec 15).Content | ConvertFrom-Json
        $e = $list.plugins | Where-Object { $_.id -eq "match-alerts" } | Select-Object -First 1
        if (-not $e -or $e.version -ne $version -or -not $e.enabled -or $e.state -ne "running" -or $e.errors -ne 0) {
            Fail "TV verification failed on $ip`: $($e | ConvertTo-Json -Compress)"
        }
        Write-Host "TV OK: $ip $($e.id) $($e.version) enabled=$($e.enabled) state=$($e.state) errors=$($e.errors)"
    }
}
