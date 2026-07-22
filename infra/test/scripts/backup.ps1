$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot '_common.ps1')

Initialize-TestDbOperation -Action 'backup'
Assert-NativeCommand -Name 'pg_dump'
Assert-NativeCommand -Name 'pg_dumpall'
Assert-NativeCommand -Name 'pg_restore'

$backupUuid = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
$timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$finalName = '{0}_{1}' -f $timestamp, $backupUuid
$finalDirectory = Join-Path $script:BackupsRoot $finalName

if (Test-Path -LiteralPath $finalDirectory) {
    throw "Refusing to overwrite existing backup directory: $finalDirectory"
}

$temporaryDirectory = Join-Path $script:BackupsRoot ('.backup-{0}-{1}' -f $backupUuid, [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryDirectory -ErrorAction Stop | Out-Null
$published = $false

try {
    $dumpFile = Join-Path $temporaryDirectory 'database.dump'
    $globalsFile = Join-Path $temporaryDirectory 'globals.sql'
    $manifestFile = Join-Path $temporaryDirectory 'manifest.txt'

    $dumpArguments = (Get-ExplicitTargetArguments) + @('--format=custom', "--file=$dumpFile")
    Invoke-CheckedNative -Command 'pg_dump' -Arguments $dumpArguments

    $globalsArguments = @(
        "--host=$script:DatabaseHost",
        "--port=$script:DatabasePort",
        "--database=$script:DatabaseName",
        "--username=$script:DatabaseUser",
        '--globals-only',
        '--no-role-passwords',
        "--file=$globalsFile"
    )
    Invoke-CheckedNative -Command 'pg_dumpall' -Arguments $globalsArguments

    if (-not (Test-Path -LiteralPath $dumpFile -PathType Leaf) -or (Get-Item -LiteralPath $dumpFile).Length -eq 0) {
        throw 'Database dump is empty.'
    }
    Invoke-CheckedNative -Command 'pg_restore' -Arguments @('--list', $dumpFile)

    if (-not (Test-Path -LiteralPath $globalsFile -PathType Leaf) -or (Get-Item -LiteralPath $globalsFile).Length -eq 0) {
        throw 'Globals SQL is empty.'
    }
    $globalsText = [System.IO.File]::ReadAllText($globalsFile)
    if ([string]::IsNullOrWhiteSpace($globalsText) -or $globalsText.IndexOf([char]0) -ge 0) {
        throw 'Globals SQL is not readable text.'
    }
    if ($globalsText -match '(?i)(^|[^a-z0-9_])password([^a-z0-9_]|$)') {
        throw 'Globals SQL unexpectedly contains a role password clause.'
    }
    if ($globalsText -cnotmatch '(?m)^CREATE ROLE backend_auth_owner;\s*$') {
        throw 'Globals SQL lacks the backend_auth_owner role definition.'
    }
    if ($globalsText -cnotmatch '(?m)^CREATE ROLE backend_auth_app;\s*$') {
        throw 'Globals SQL lacks the backend_auth_app role definition.'
    }

    $versionOutput = @(& pg_dump --version)
    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump --version failed with exit code $LASTEXITCODE."
    }
    $clientVersion = ($versionOutput -join ' ').Trim()
    if ([string]::IsNullOrWhiteSpace($clientVersion)) {
        throw 'PostgreSQL client version is empty.'
    }

    $dumpSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $dumpFile).Hash.ToLowerInvariant()
    $globalsSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $globalsFile).Hash.ToLowerInvariant()
    $manifestLines = @(
        'format_version=1',
        "database=$script:DatabaseName",
        "host=$script:DatabaseHost",
        "port=$script:DatabasePort",
        "user=$script:DatabaseUser",
        "utc_timestamp=$timestamp",
        "postgresql_client_version=$clientVersion",
        "dump_sha256=$dumpSha256",
        "globals_sha256=$globalsSha256"
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $manifestText = ($manifestLines -join "`n") + "`n"
    [System.IO.File]::WriteAllText($manifestFile, $manifestText, $utf8NoBom)

    if ((Get-Item -LiteralPath $manifestFile).Length -eq 0) {
        throw 'Backup manifest is empty.'
    }
    if ($dumpSha256 -notmatch '^[0-9a-f]{64}$' -or $globalsSha256 -notmatch '^[0-9a-f]{64}$') {
        throw 'Backup manifest SHA-256 value is invalid.'
    }

    [System.IO.Directory]::Move($temporaryDirectory, $finalDirectory)
    $published = $true
}
finally {
    if (-not $published -and (Test-Path -LiteralPath $temporaryDirectory -PathType Container)) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
}

Write-Host "Backup published: $finalDirectory"
