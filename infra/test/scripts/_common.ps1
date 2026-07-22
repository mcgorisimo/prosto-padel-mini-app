Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:TestRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:WorkspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $script:TestRoot '..'))
$hostMigrationsRoot = [System.IO.Path]::GetFullPath((Join-Path $script:TestRoot '..\..\docs\migrations'))
$script:MigrationsRoot = if (Test-Path -LiteralPath $hostMigrationsRoot -PathType Container) {
    $hostMigrationsRoot
} else {
    Join-Path $script:WorkspaceRoot 'migrations'
}
$script:BackupsRoot = Join-Path $script:TestRoot 'backups'

function Test-EnvironmentVariableExists {
    param([Parameter(Mandatory = $true)][string]$Name)

    return Test-Path -LiteralPath "Env:$Name"
}

function Reject-AmbientLibpqTarget {
    $forbiddenVariables = @(
        'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGSERVICE',
        'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS'
    )
    foreach ($name in $forbiddenVariables) {
        if (Test-EnvironmentVariableExists -Name $name) {
            throw "REFUSED: $name must be unset; wrappers pass every target parameter explicitly"
        }
    }
    foreach ($name in $forbiddenVariables) {
        Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    }
}

function Initialize-TestDbOperation {
    param([Parameter(Mandatory = $true)][string]$Action)

    if ($env:ALLOW_LOCAL_TEST_DB_OPERATIONS -cne 'YES') {
        throw 'REFUSED: set ALLOW_LOCAL_TEST_DB_OPERATIONS=YES for this manual test operation'
    }

    Reject-AmbientLibpqTarget

    $requiredVariables = @(
        'EXPECTED_TEST_DATABASE_HOST', 'DATABASE_HOST', 'DATABASE_PORT',
        'DATABASE_NAME', 'DATABASE_USER'
    )
    foreach ($name in $requiredVariables) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ([string]::IsNullOrWhiteSpace($value)) {
            throw "REFUSED: $name is required and must not be whitespace-only"
        }
        if ($value -cne $value.Trim()) {
            throw "REFUSED: $name must not contain surrounding whitespace"
        }
    }

    $expectedHost = $env:EXPECTED_TEST_DATABASE_HOST.Trim()
    $databaseHost = $env:DATABASE_HOST.Trim()
    $databasePort = $env:DATABASE_PORT.Trim()
    $databaseName = $env:DATABASE_NAME.Trim()
    $databaseUser = $env:DATABASE_USER.Trim()

    if ($expectedHost -cne 'postgres') {
        throw 'REFUSED: EXPECTED_TEST_DATABASE_HOST must be exactly postgres'
    }
    if ($databaseHost -cne $expectedHost) {
        throw 'REFUSED: DATABASE_HOST must exactly match EXPECTED_TEST_DATABASE_HOST'
    }
    if ($databaseHost.Contains(',') -or $databaseHost.Contains(' ') -or
        $databaseHost.Contains('://') -or $databaseHost.StartsWith('/')) {
        throw 'REFUSED: DATABASE_HOST must be one non-URI, non-socket host'
    }
    if ($databaseHost -in @('localhost', 'localhost.', '::1', '[::1]', '0.0.0.0') -or
        $databaseHost -match '^127\.') {
        throw 'REFUSED: localhost, loopback, and wildcard database hosts are forbidden'
    }
    if ($databasePort -cne '5432') {
        throw 'REFUSED: DATABASE_PORT must be exactly 5432'
    }
    if ($databaseName -cnotmatch '^prosto_padel_test_[a-z0-9_]+$') {
        throw 'REFUSED: DATABASE_NAME must match ^prosto_padel_test_[a-z0-9_]+$'
    }
    if ($databaseUser -match '[\r\n\t]') {
        throw 'REFUSED: DATABASE_USER must not contain control whitespace'
    }
    if ("$databaseHost $databaseName" -match '(?i)(production|prod|main|live)') {
        throw 'REFUSED: DATABASE_HOST and DATABASE_NAME must not contain production-like markers'
    }

    $script:DatabaseHost = $databaseHost
    $script:DatabasePort = $databasePort
    $script:DatabaseName = $databaseName
    $script:DatabaseUser = $databaseUser

    Write-Host "Action: $Action"
    Write-Host "Host: $($script:DatabaseHost)"
    Write-Host "Port: $($script:DatabasePort)"
    Write-Host "Database: $($script:DatabaseName)"
    Write-Host "User: $($script:DatabaseUser)"
}

function Assert-NativeCommand {
    param([Parameter(Mandatory = $true)][string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "REFUSED: required command is unavailable: $Name"
    }
}

function Assert-RequiredFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "REFUSED: required file is missing: $Path"
    }
}

function Invoke-CheckedNative {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE"
    }
}

function Get-ExplicitTargetArguments {
    param([string]$Database = $script:DatabaseName)

    return @(
        "--host=$($script:DatabaseHost)",
        "--port=$($script:DatabasePort)",
        "--dbname=$Database",
        "--username=$($script:DatabaseUser)"
    )
}

function Invoke-Psql {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$Database = $script:DatabaseName
    )

    Invoke-CheckedNative -Command 'psql' -Arguments ((Get-ExplicitTargetArguments -Database $Database) + $Arguments)
}

function Invoke-PsqlScalar {
    param(
        [Parameter(Mandatory = $true)][string]$Query,
        [string]$Database = $script:DatabaseName
    )

    $arguments = (Get-ExplicitTargetArguments -Database $Database) + @(
        '-X', '-A', '-t', '-q', '--set=ON_ERROR_STOP=1', "--command=$Query"
    )
    $output = & psql @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "psql failed with exit code $LASTEXITCODE"
    }
    return (($output | Out-String).Trim())
}
