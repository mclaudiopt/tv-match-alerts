# check-nc.ps1 - does the Notification Center on the TV have anything new?
#
# Run this at the start of every request that touches the TV alerts Shard (or the Notification
# Center). The NC API describes itself, so it is the source of truth: version, enums, fields and
# limits are compared with the last snapshot. Exit codes: 0 = same, 1 = changed, 2 = unreachable.
#
#   pwsh -File check-nc.ps1
#   pwsh -File check-nc.ps1 -Tv 192.168.1.7:8099

param([string]$Tv = "192.168.1.7:8099")

$ErrorActionPreference = "Stop"
$snap = Join-Path $PSScriptRoot ".nc-api.json"

try {
    $api = Invoke-RestMethod -Method GET -Uri "http://$Tv/plugins/notification-center/api/api" -TimeoutSec 8
} catch {
    "NC API unreachable at $Tv : " + $_.Exception.Message
    exit 2
}

$summary = [ordered]@{
    version = [string]$api.version
    modes   = @($api.enums.mode | ForEach-Object { [string]$_ })
    levels  = @($api.enums.level | ForEach-Object { [string]$_ })
    sounds  = @($api.enums.sound | ForEach-Object { [string]$_ })
    fields  = @($api.fields.PSObject.Properties.Name | ForEach-Object { [string]$_ })
    limits  = @($api.limits.PSObject.Properties.Name | ForEach-Object { [string]$_ })
}

# What the plugin manager thinks is installed (can lag behind the API if a Shard updated itself).
try {
    $list = Invoke-RestMethod -Method GET -Uri "http://$Tv/plugins" -TimeoutSec 8
    $nc = $list.plugins | Where-Object { $_.id -eq "notification-center" } | Select-Object -First 1
    if ($nc) { "manager : notification-center " + $nc.version + " enabled=" + $nc.enabled + " state=" + $nc.state }
} catch { "manager : (plugin list unavailable)" }

"version : " + $summary.version
"modes   : " + ($summary.modes -join ", ")
"levels  : " + ($summary.levels -join ", ")
"sounds  : " + ($summary.sounds -join ", ")
"fields  : " + ($summary.fields -join ", ")
"limits  : " + ($summary.limits -join ", ")

if (-not (Test-Path $snap)) {
    $summary | ConvertTo-Json -Depth 4 | Set-Content -Path $snap -Encoding UTF8
    "snapshot: created (first run)"
    exit 0
}

$old = Get-Content $snap -Raw | ConvertFrom-Json
$diffs = @()
foreach ($k in @("version", "modes", "levels", "sounds", "fields", "limits")) {
    $a = (@($old.$k) | ForEach-Object { [string]$_ }) -join ","
    $b = (@($summary[$k]) | ForEach-Object { [string]$_ }) -join ","
    if ($a -ne $b) { $diffs += ("  " + $k + ": [" + $a + "] -> [" + $b + "]") }
}

if ($diffs.Count -eq 0) {
    "no change since the last check"
    exit 0
}

"CHANGED since the last check:"
$diffs | ForEach-Object { $_ }
$summary | ConvertTo-Json -Depth 4 | Set-Content -Path $snap -Encoding UTF8
"snapshot updated - read the new fields in GET /api before using them"
exit 1
