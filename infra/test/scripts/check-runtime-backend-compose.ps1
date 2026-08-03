$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$infraRoot = Split-Path -Parent $PSScriptRoot
$baseComposePath = Join-Path $infraRoot 'compose.yaml'
$runtimeComposePath = Join-Path $infraRoot 'compose.runtime-backend.yaml'
$repoRoot = Split-Path -Parent (Split-Path -Parent $infraRoot)
$backendDockerfilePath = Join-Path $repoRoot 'backend/Dockerfile'

$baseCompose = Get-Content -Raw -LiteralPath $baseComposePath
$runtimeCompose = Get-Content -Raw -LiteralPath $runtimeComposePath
$backendDockerfile = Get-Content -Raw -LiteralPath $backendDockerfilePath

function Get-ServiceBlock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Yaml,
        [Parameter(Mandatory = $true)]
        [string]$ServiceName
    )

    $escapedName = [regex]::Escape($ServiceName)
    $pattern = "(?ms)^  ${escapedName}:\r?\n.*?(?=^  [A-Za-z0-9_-]+:\r?$|^\S|\z)"
    $match = [regex]::Match($Yaml, $pattern)
    if (-not $match.Success) {
        throw "RUNTIME_BACKEND_COMPOSE_SERVICE_MISSING"
    }
    return $match.Value
}

function Get-NormalizedLines {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    return @(
        ($Text -replace "`r`n", "`n") -split "`n" |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_.Length -gt 0 }
    )
}

function Get-ChildBlock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ServiceBlock,
        [Parameter(Mandatory = $true)]
        [string]$ChildName
    )

    $escapedName = [regex]::Escape($ChildName)
    $pattern = "(?ms)^    ${escapedName}:\r?\n.*?(?=^    [A-Za-z0-9_-]+:\r?$|^  [A-Za-z0-9_-]+:\r?$|^\S|\z)"
    $match = [regex]::Match($ServiceBlock, $pattern)
    if (-not $match.Success) {
        throw "RUNTIME_BACKEND_COMPOSE_CHILD_BLOCK_MISSING"
    }
    return $match.Value
}

function Assert-Line {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Lines,
        [Parameter(Mandatory = $true)]
        [string]$Expected
    )

    if ($Expected -notin $Lines) {
        throw "RUNTIME_BACKEND_COMPOSE_LINE_MISSING"
    }
}

function Get-EnvironmentValues {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EnvironmentBlock,
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    $escapedKey = [regex]::Escape($Key)
    $pattern = "(?m)^      ${escapedKey}:\s*(?<value>[^\r\n]*)\r?$"
    return @(
        [regex]::Matches($EnvironmentBlock, $pattern) |
            ForEach-Object { $_.Groups['value'].Value.Trim() }
    )
}

function Assert-EnvironmentEntry {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EnvironmentBlock,
        [Parameter(Mandatory = $true)]
        [string]$Key,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedValue
    )

    $values = @(
        Get-EnvironmentValues -EnvironmentBlock $EnvironmentBlock -Key $Key
    )
    if ($values.Count -ne 1 -or $values[0] -ne $ExpectedValue) {
        throw "RUNTIME_BACKEND_COMPOSE_ENVIRONMENT_INVALID"
    }
}

function Get-MountBlocks {
    param(
        [Parameter(Mandatory = $true)]
        [string]$VolumesBlock
    )

    return @(
        [regex]::Matches(
            $VolumesBlock,
            '(?ms)^      - type:\s*[^\r\n]+\r?\n.*?(?=^      - type:|\z)'
        ) |
            ForEach-Object { $_.Value }
    )
}

function Get-MountField {
    param(
        [Parameter(Mandatory = $true)]
        [string]$MountBlock,
        [Parameter(Mandatory = $true)]
        [ValidateSet('type', 'source', 'target', 'read_only')]
        [string]$FieldName
    )

    $indent = if ($FieldName -eq 'type') { '      - ' } else { '        ' }
    $pattern = "(?m)^${indent}${FieldName}:\s*(?<value>[^\r\n]*)\r?$"
    $matches = [regex]::Matches($MountBlock, $pattern)
    if ($matches.Count -ne 1) {
        throw "RUNTIME_BACKEND_COMPOSE_MOUNT_INVALID"
    }
    return $matches[0].Groups['value'].Value.Trim()
}

function Assert-RuntimeBackendContract {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ServiceBlock
    )

    $environment = Get-ChildBlock `
        -ServiceBlock $ServiceBlock `
        -ChildName 'environment'
    $expectedEnvironment = [ordered]@{
        DATABASE_URL = '!reset null'
        DATABASE_PASSWORD = '!reset null'
        DATABASE_ENABLED = '"true"'
        DATABASE_HOST = 'postgres'
        DATABASE_PORT = '"5432"'
        DATABASE_NAME = 'prosto_padel_test_migration_cycle'
        DATABASE_USER = 'backend_auth_app'
        DATABASE_PASSWORD_FILE = '/run/secrets/backend-auth-app-password'
        TELEGRAM_AUTH_ENABLED = '${TELEGRAM_AUTH_ENABLED:-false}'
        TELEGRAM_BOT_TOKEN = '!reset null'
        TELEGRAM_IDENTITY_LOOKUP_PEPPER_BASE64 = '!reset null'
        TELEGRAM_LOGIN_WORKFLOW_HMAC_SECRET_BASE64 = '!reset null'
        TELEGRAM_INIT_DATA_MAX_AGE_SECONDS = '${TELEGRAM_INIT_DATA_MAX_AGE_SECONDS:?TELEGRAM_INIT_DATA_MAX_AGE_SECONDS is required}'
        TELEGRAM_LOGIN_UUID_NAMESPACE = '${TELEGRAM_LOGIN_UUID_NAMESPACE:?TELEGRAM_LOGIN_UUID_NAMESPACE is required}'
        TELEGRAM_OUTBOUND_NOTIFICATIONS_ENABLED = '${TELEGRAM_OUTBOUND_NOTIFICATIONS_ENABLED:-false}'
        TELEGRAM_MINI_APP_URL = '${TELEGRAM_MINI_APP_URL:-https://app.prostopdl.ru/}'
        TELEGRAM_BOT_TOKEN_FILE = '/run/secrets/telegram-bot-token'
        TELEGRAM_IDENTITY_LOOKUP_PEPPER_BASE64_FILE = '/run/secrets/telegram-identity-lookup-pepper-base64'
        TELEGRAM_LOGIN_WORKFLOW_HMAC_SECRET_BASE64_FILE = '/run/secrets/telegram-login-workflow-hmac-secret-base64'
    }

    foreach ($entry in $expectedEnvironment.GetEnumerator()) {
        Assert-EnvironmentEntry `
            -EnvironmentBlock $environment `
            -Key $entry.Key `
            -ExpectedValue $entry.Value
    }

    $volumes = Get-ChildBlock `
        -ServiceBlock $ServiceBlock `
        -ChildName 'volumes'
    $mountBlocks = @(Get-MountBlocks -VolumesBlock $volumes)
    if ($mountBlocks.Count -ne 4) {
        throw "RUNTIME_BACKEND_COMPOSE_MOUNT_INVALID"
    }

    $expectedMounts = [ordered]@{
        '${BACKEND_AUTH_APP_PASSWORD_FILE_HOST:?BACKEND_AUTH_APP_PASSWORD_FILE_HOST is required}' = '/run/secrets/backend-auth-app-password'
        '${TELEGRAM_BOT_TOKEN_FILE_HOST:?TELEGRAM_BOT_TOKEN_FILE_HOST is required}' = '/run/secrets/telegram-bot-token'
        '${TELEGRAM_IDENTITY_LOOKUP_PEPPER_BASE64_FILE_HOST:?TELEGRAM_IDENTITY_LOOKUP_PEPPER_BASE64_FILE_HOST is required}' = '/run/secrets/telegram-identity-lookup-pepper-base64'
        '${TELEGRAM_LOGIN_WORKFLOW_HMAC_SECRET_BASE64_FILE_HOST:?TELEGRAM_LOGIN_WORKFLOW_HMAC_SECRET_BASE64_FILE_HOST is required}' = '/run/secrets/telegram-login-workflow-hmac-secret-base64'
    }
    $seenSources = @{}
    $seenTargets = @{}

    foreach ($mountBlock in $mountBlocks) {
        $type = Get-MountField -MountBlock $mountBlock -FieldName 'type'
        $source = Get-MountField -MountBlock $mountBlock -FieldName 'source'
        $target = Get-MountField -MountBlock $mountBlock -FieldName 'target'
        $readOnly = Get-MountField -MountBlock $mountBlock -FieldName 'read_only'

        if (
            $type -ne 'bind' -or
            $readOnly -ne 'true' -or
            -not $expectedMounts.Contains($source) -or
            $expectedMounts[$source] -ne $target -or
            $seenSources.ContainsKey($source) -or
            $seenTargets.ContainsKey($target)
        ) {
            throw "RUNTIME_BACKEND_COMPOSE_MOUNT_INVALID"
        }

        $seenSources[$source] = $true
        $seenTargets[$target] = $true
    }

    if (
        $seenSources.Count -ne $expectedMounts.Count -or
        $seenTargets.Count -ne $expectedMounts.Count
    ) {
        throw "RUNTIME_BACKEND_COMPOSE_MOUNT_INVALID"
    }
}

function Replace-First {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text,
        [Parameter(Mandatory = $true)]
        [string]$OldValue,
        [Parameter(Mandatory = $true)]
        [string]$NewValue
    )

    $index = $Text.IndexOf($OldValue, [StringComparison]::Ordinal)
    if ($index -lt 0) {
        throw "RUNTIME_BACKEND_COMPOSE_SELF_TEST_SETUP_INVALID"
    }
    return $Text.Substring(0, $index) +
        $NewValue +
        $Text.Substring($index + $OldValue.Length)
}

function Assert-RejectedMutation {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ServiceBlock,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedError
    )

    try {
        Assert-RuntimeBackendContract -ServiceBlock $ServiceBlock
    } catch {
        if ($_.Exception.Message -eq $ExpectedError) {
            return
        }
        throw
    }
    throw "RUNTIME_BACKEND_COMPOSE_SELF_TEST_NOT_REJECTED"
}

$basePostgres = Get-NormalizedLines (
    Get-ServiceBlock -Yaml $baseCompose -ServiceName 'postgres'
)
$baseBackend = Get-NormalizedLines (
    Get-ServiceBlock -Yaml $baseCompose -ServiceName 'backend'
)
$baseFrontend = Get-NormalizedLines (
    Get-ServiceBlock -Yaml $baseCompose -ServiceName 'frontend'
)
$baseNginx = Get-NormalizedLines (
    Get-ServiceBlock -Yaml $baseCompose -ServiceName 'nginx'
)
$baseRunner = Get-NormalizedLines (
    Get-ServiceBlock -Yaml $baseCompose -ServiceName 'auth-integration-runner'
)
$baseDbTools = Get-NormalizedLines (
    Get-ServiceBlock -Yaml $baseCompose -ServiceName 'db-tools'
)
$baseEgressNetwork = Get-NormalizedLines (
    Get-ServiceBlock -Yaml $baseCompose -ServiceName 'test_egress'
)
$runtimeBackendBlock = Get-ServiceBlock `
    -Yaml $runtimeCompose `
    -ServiceName 'backend'
$runtimeBackend = Get-NormalizedLines $runtimeBackendBlock

Assert-Line $basePostgres 'POSTGRES_USER: ${TEST_POSTGRES_USER:-prosto_padel_test}'
Assert-Line $basePostgres 'POSTGRES_PASSWORD: ${TEST_POSTGRES_PASSWORD:-local_test_password_only}'
Assert-Line $baseDbTools 'DATABASE_USER: ${DATABASE_USER:-prosto_padel_test}'
Assert-Line $baseDbTools 'PGPASSWORD: ${TEST_POSTGRES_PASSWORD:-local_test_password_only}'
Assert-Line $baseBackend 'DATABASE_URL: postgresql://${TEST_POSTGRES_USER:-prosto_padel_test}:${TEST_POSTGRES_PASSWORD:-local_test_password_only}@postgres:5432/${TEST_POSTGRES_DB:-prosto_padel_test_migration_cycle}'
Assert-Line $baseBackend '- test_internal'
Assert-Line $baseBackend '- test_egress'
Assert-Line $baseEgressNetwork 'driver: bridge'

if (
    ($basePostgres -join "`n") -match '(^|\n)- test_egress($|\n)' -or
    ($baseFrontend -join "`n") -match '(^|\n)- test_egress($|\n)' -or
    ($baseNginx -join "`n") -match '(^|\n)- test_egress($|\n)' -or
    ($baseRunner -join "`n") -match '(^|\n)- test_egress($|\n)' -or
    ($baseDbTools -join "`n") -match '(^|\n)- test_egress($|\n)' -or
    $baseEgressNetwork.Count -ne 2
) {
    throw "RUNTIME_BACKEND_COMPOSE_EGRESS_BOUNDARY_INVALID"
}

Assert-RuntimeBackendContract -ServiceBlock $runtimeBackendBlock

if (
    ($baseRunner -join "`n") -match '/run/secrets|_FILE_HOST' -or
    ($runtimeBackend -join "`n") -match 'TEST_POSTGRES_(USER|PASSWORD)' -or
    ($runtimeBackend -join "`n") -match '(^|\n)(ports|expose|user|privileged):' -or
    ($runtimeBackend -join "`n") -match 'TELEGRAM_BOT_TOKEN:\s+[^!]' -or
    ($runtimeBackend -join "`n") -match 'TELEGRAM_IDENTITY_LOOKUP_PEPPER_BASE64:\s+[^!]' -or
    ($runtimeBackend -join "`n") -match 'TELEGRAM_LOGIN_WORKFLOW_HMAC_SECRET_BASE64:\s+[^!]' -or
    ($backendDockerfile -replace "`r`n", "`n") -notmatch '(?m)^USER node$'
) {
    throw "RUNTIME_BACKEND_COMPOSE_SECRET_BOUNDARY_INVALID"
}

$extraDatabaseUrl = Replace-First `
    -Text $runtimeBackendBlock `
    -OldValue '      DATABASE_URL: !reset null' `
    -NewValue "      DATABASE_URL: !reset null`n      DATABASE_URL: postgresql://forbidden.invalid/runtime"
Assert-RejectedMutation `
    -ServiceBlock $extraDatabaseUrl `
    -ExpectedError 'RUNTIME_BACKEND_COMPOSE_ENVIRONMENT_INVALID'

$extraDatabasePassword = Replace-First `
    -Text $runtimeBackendBlock `
    -OldValue '      DATABASE_PASSWORD: !reset null' `
    -NewValue "      DATABASE_PASSWORD: !reset null`n      DATABASE_PASSWORD: forbidden-test-value"
Assert-RejectedMutation `
    -ServiceBlock $extraDatabasePassword `
    -ExpectedError 'RUNTIME_BACKEND_COMPOSE_ENVIRONMENT_INVALID'

$firstTarget = '        target: /run/secrets/backend-auth-app-password'
$secondTarget = '        target: /run/secrets/telegram-bot-token'
$swapSentinel = '        target: /run/secrets/__runtime-backend-swap-sentinel__'
$swappedTargets = $runtimeBackendBlock.Replace($firstTarget, $swapSentinel)
$swappedTargets = $swappedTargets.Replace($secondTarget, $firstTarget)
$swappedTargets = $swappedTargets.Replace($swapSentinel, $secondTarget)
Assert-RejectedMutation `
    -ServiceBlock $swappedTargets `
    -ExpectedError 'RUNTIME_BACKEND_COMPOSE_MOUNT_INVALID'

$writableMount = Replace-First `
    -Text $runtimeBackendBlock `
    -OldValue '        read_only: true' `
    -NewValue '        read_only: false'
Assert-RejectedMutation `
    -ServiceBlock $writableMount `
    -ExpectedError 'RUNTIME_BACKEND_COMPOSE_MOUNT_INVALID'

Write-Output 'RUNTIME_BACKEND_COMPOSE_STATIC_CHECK_OK'
