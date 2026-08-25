$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$infraRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $infraRoot)

function Read-RequiredFile {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $path = Join-Path $repositoryRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "OBSERVABILITY_REQUIRED_FILE_MISSING:$RelativePath"
    }
    return Get-Content -LiteralPath $path -Raw
}

function Assert-Contains {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [Parameter(Mandatory = $true)][string]$Code
    )

    if ($Text -notmatch $Pattern) {
        throw $Code
    }
}

$compose = Read-RequiredFile 'infra/test/compose.yaml'
$runtime = Read-RequiredFile 'infra/test/compose.runtime-backend.yaml'
$nginx = Read-RequiredFile 'infra/test/nginx/nginx.conf'
$vector = Read-RequiredFile 'infra/test/observability/vector.yaml'
$loki = Read-RequiredFile 'infra/test/observability/loki.yaml'
$prometheus = Read-RequiredFile 'infra/test/observability/prometheus.yaml'
$alerts = Read-RequiredFile 'infra/test/observability/alerts.yaml'
$alertmanager = Read-RequiredFile 'infra/test/observability/alertmanager.yaml'
$datasources = Read-RequiredFile 'infra/test/observability/grafana/provisioning/datasources/datasources.yaml'
$dashboardProvider = Read-RequiredFile 'infra/test/observability/grafana/provisioning/dashboards/dashboards.yaml'
$dashboard = Read-RequiredFile 'infra/test/observability/grafana/dashboards/prosto-padel-overview.json'

Assert-Contains $compose 'driver:\s+gelf' 'OBSERVABILITY_GELF_DRIVER_MISSING'
Assert-Contains $compose 'gelf-address:\s+"udp://127\.0\.0\.1:12201"' 'OBSERVABILITY_GELF_NOT_LOOPBACK'
Assert-Contains $compose 'mode:\s+"non-blocking"' 'OBSERVABILITY_GELF_NOT_NON_BLOCKING'
Assert-Contains $compose '127\.0\.0\.1:3001:3000' 'OBSERVABILITY_GRAFANA_NOT_LOOPBACK'
Assert-Contains $compose 'observability_internal:\s*\r?\n\s+internal:\s+true' 'OBSERVABILITY_NETWORK_NOT_INTERNAL'
if ($compose -match 'docker\.sock') {
    throw 'OBSERVABILITY_DOCKER_SOCKET_FORBIDDEN'
}

Assert-Contains $runtime 'GF_SECURITY_ADMIN_PASSWORD:\s+!reset null' 'OBSERVABILITY_GRAFANA_INLINE_PASSWORD_NOT_RESET'
Assert-Contains $runtime 'GF_SECURITY_ADMIN_PASSWORD__FILE:\s+/run/secrets/grafana-admin-password' 'OBSERVABILITY_GRAFANA_PASSWORD_FILE_MISSING'
Assert-Contains $nginx 'location = /api/v1/metrics\s*\{\s*access_log off;\s*return 404;' 'OBSERVABILITY_PUBLIC_METRICS_NOT_BLOCKED'
Assert-Contains $nginx 'location = /api/v1/metrics/\s*\{\s*access_log off;\s*return 404;' 'OBSERVABILITY_PUBLIC_METRICS_TRAILING_SLASH_NOT_BLOCKED'

Assert-Contains $vector 'type:\s+socket' 'OBSERVABILITY_VECTOR_GELF_SOURCE_MISSING'
Assert-Contains $vector 'type:\s+loki' 'OBSERVABILITY_VECTOR_LOKI_SINK_MISSING'
Assert-Contains $vector 'type:\s+prometheus_exporter' 'OBSERVABILITY_VECTOR_METRICS_MISSING'
Assert-Contains $loki 'retention_period:\s+336h' 'OBSERVABILITY_LOKI_RETENTION_INVALID'
Assert-Contains $prometheus 'metrics_path:\s+/api/v1/metrics' 'OBSERVABILITY_BACKEND_SCRAPE_MISSING'
Assert-Contains $prometheus 'alertmanager:9093' 'OBSERVABILITY_ALERTMANAGER_TARGET_MISSING'

foreach ($alertName in @(
    'ProstoPadelBackendDown',
    'ProstoPadelBackendHttp5xx',
    'ProstoPadelBackendP95LatencyHigh',
    'ProstoPadelDomainDependencyFailure',
    'ProstoPadelHostDiskSpaceLow',
    'ProstoPadelHostMemoryLow'
)) {
    Assert-Contains $alerts "alert:\s+$alertName" "OBSERVABILITY_ALERT_MISSING:$alertName"
}

Assert-Contains $alertmanager 'receiver:\s+local-observability-ui' 'OBSERVABILITY_LOCAL_ALERT_RECEIVER_MISSING'
Assert-Contains $datasources 'uid:\s+prosto-padel-prometheus' 'OBSERVABILITY_PROMETHEUS_DATASOURCE_MISSING'
Assert-Contains $datasources 'uid:\s+prosto-padel-loki' 'OBSERVABILITY_LOKI_DATASOURCE_MISSING'
Assert-Contains $dashboardProvider 'path:\s+/var/lib/grafana/dashboards' 'OBSERVABILITY_DASHBOARD_PROVIDER_MISSING'

try {
    $parsedDashboard = $dashboard | ConvertFrom-Json
} catch {
    throw 'OBSERVABILITY_DASHBOARD_JSON_INVALID'
}
if ($parsedDashboard.uid -ne 'prosto-padel-test-overview' -or $parsedDashboard.panels.Count -lt 8) {
    throw 'OBSERVABILITY_DASHBOARD_CONTRACT_INVALID'
}

Write-Output 'OBSERVABILITY_CONFIG_STATIC_CHECK_OK'
