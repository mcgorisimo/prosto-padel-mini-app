param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$BackupDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot '_common.ps1')

Initialize-TestDbOperation -Action 'restore into a newly created test database'
Assert-NativeCommand -Name 'psql'
Assert-NativeCommand -Name 'createdb'
Assert-NativeCommand -Name 'pg_restore'

if (-not (Test-Path -LiteralPath $script:BackupsRoot -PathType Container)) {
    throw "REFUSED: backups directory is missing: $($script:BackupsRoot)"
}

$candidateDirectory = if ([System.IO.Path]::IsPathRooted($BackupDirectory)) {
    $BackupDirectory
} else {
    Join-Path $script:BackupsRoot $BackupDirectory
}
if (-not (Test-Path -LiteralPath $candidateDirectory -PathType Container)) {
    throw "REFUSED: backup set directory does not exist: $candidateDirectory"
}
$candidateItem = Get-Item -LiteralPath $candidateDirectory -Force
if (($candidateItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'REFUSED: backup set directory must not be a symlink or reparse point'
}

$backupsRootResolved = (Resolve-Path -LiteralPath $script:BackupsRoot).Path
$backupDirectoryResolved = (Resolve-Path -LiteralPath $candidateDirectory).Path
$backupParent = [System.IO.Directory]::GetParent($backupDirectoryResolved).FullName
if (-not $backupParent.Equals($backupsRootResolved, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'REFUSED: backup set must be a direct child of infra/test/backups'
}

$allowedBackupEntries = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::Ordinal
)
foreach ($allowedBackupEntry in @('database.dump', 'globals.sql', 'manifest.txt')) {
    [void]$allowedBackupEntries.Add($allowedBackupEntry)
}
$unexpectedBackupEntries = @(
    Get-ChildItem -LiteralPath $backupDirectoryResolved -Force |
        Where-Object { -not $allowedBackupEntries.Contains($_.Name) }
)
if ($unexpectedBackupEntries.Count -gt 0) {
    throw "REFUSED: backup set contains an unexpected entry: $($unexpectedBackupEntries[0].Name)"
}

$requiredFiles = @{}
foreach ($name in $allowedBackupEntries) {
    $path = Join-Path $backupDirectoryResolved $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "REFUSED: required backup file is missing: $path"
    }
    $item = Get-Item -LiteralPath $path -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "REFUSED: backup files must not be symlinks or reparse points: $path"
    }
    if ($item.Length -eq 0) {
        throw "REFUSED: required backup file is empty: $path"
    }
    $resolvedPath = (Resolve-Path -LiteralPath $path).Path
    $expectedPath = [System.IO.Path]::GetFullPath($path)
    if (-not $resolvedPath.Equals($expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "REFUSED: backup file resolves outside its expected path: $path"
    }
    $requiredFiles[$name] = $resolvedPath
}

$manifestLines = [System.IO.File]::ReadAllLines($requiredFiles['manifest.txt'])
$allowedKeys = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::Ordinal
)
foreach ($allowedKey in @(
    'format_version', 'database', 'host', 'port', 'user', 'utc_timestamp',
    'postgresql_client_version', 'dump_sha256', 'globals_sha256'
)) {
    [void]$allowedKeys.Add($allowedKey)
}
if ($manifestLines.Count -ne $allowedKeys.Count) {
    throw 'REFUSED: manifest must contain exactly nine fields'
}
$manifest = [System.Collections.Generic.Dictionary[string, string]]::new(
    [System.StringComparer]::Ordinal
)
foreach ($line in $manifestLines) {
    $separator = $line.IndexOf('=')
    if ($separator -le 0) {
        throw 'REFUSED: manifest contains a malformed field'
    }
    $key = $line.Substring(0, $separator)
    $value = $line.Substring($separator + 1)
    if (-not $allowedKeys.Contains($key) -or
        $manifest.ContainsKey($key) -or
        [string]::IsNullOrEmpty($value)) {
        throw "REFUSED: manifest field is unknown, duplicated, or empty: $key"
    }
    $manifest.Add($key, $value)
}
foreach ($key in $allowedKeys) {
    if (-not $manifest.ContainsKey($key)) {
        throw "REFUSED: manifest field is missing: $key"
    }
}

if ($manifest['format_version'] -cne '1') {
    throw 'REFUSED: unsupported backup manifest format'
}
if ($manifest['database'] -cnotmatch '^prosto_padel_test_[a-z0-9_]+$') {
    throw 'REFUSED: manifest source database is unsafe'
}
if ($manifest['database'] -ceq $script:DatabaseName) {
    throw 'REFUSED: restore target must differ from the source database'
}
if ($manifest['host'] -cne 'postgres' -or $manifest['port'] -cne '5432') {
    throw 'REFUSED: manifest source target is not the allowed Compose PostgreSQL service'
}
if ([string]::IsNullOrWhiteSpace($manifest['user']) -or $manifest['user'] -cne $manifest['user'].Trim()) {
    throw 'REFUSED: manifest user is invalid'
}
if ($manifest['utc_timestamp'] -cnotmatch '^[0-9]{8}T[0-9]{6}Z$') {
    throw 'REFUSED: manifest UTC timestamp is invalid'
}
if ([string]::IsNullOrWhiteSpace($manifest['postgresql_client_version'])) {
    throw 'REFUSED: manifest PostgreSQL client version is invalid'
}
if ($manifest['dump_sha256'] -cnotmatch '^[0-9a-f]{64}$' -or
    $manifest['globals_sha256'] -cnotmatch '^[0-9a-f]{64}$') {
    throw 'REFUSED: manifest SHA-256 is invalid'
}

$actualDumpSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $requiredFiles['database.dump']).Hash.ToLowerInvariant()
$actualGlobalsSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $requiredFiles['globals.sql']).Hash.ToLowerInvariant()
if ($actualDumpSha256 -cne $manifest['dump_sha256']) {
    throw 'REFUSED: database.dump SHA-256 mismatch'
}
if ($actualGlobalsSha256 -cne $manifest['globals_sha256']) {
    throw 'REFUSED: globals.sql SHA-256 mismatch'
}

$globalsText = [System.IO.File]::ReadAllText($requiredFiles['globals.sql'])
if ([string]::IsNullOrWhiteSpace($globalsText) -or $globalsText.IndexOf([char]0) -ge 0) {
    throw 'REFUSED: globals.sql is not readable text'
}
if ($globalsText -match '(?i)(^|[^a-z0-9_])password([^a-z0-9_]|$)') {
    throw 'REFUSED: globals.sql contains a role password clause and will not be accepted'
}
if ($globalsText -cnotmatch '(?m)^CREATE ROLE backend_auth_owner;\s*$') {
    throw 'REFUSED: globals.sql lacks the backend_auth_owner role definition'
}
if ($globalsText -cnotmatch '(?m)^CREATE ROLE backend_auth_app;\s*$') {
    throw 'REFUSED: globals.sql lacks the backend_auth_app role definition'
}

# Archive validation is deliberately completed before the first database connection.
Invoke-CheckedNative -Command 'pg_restore' -Arguments @('--list', $requiredFiles['database.dump'])

$rolesAreSafe = Invoke-PsqlScalar -Database 'postgres' -Query @'
select case when
  exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'backend_auth_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb
      and not rolcreaterole and not rolinherit and not rolreplication and not rolbypassrls
  )
  and exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'backend_auth_app'
      and rolcanlogin and not rolsuper and not rolcreatedb
      and not rolcreaterole and not rolinherit and not rolreplication and not rolbypassrls
  )
  and not pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER')
  and pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER')
then 'YES' else 'NO' end;
'@
if ($rolesAreSafe -cne 'YES') {
    throw 'REFUSED: required roles are missing or unsafe; run provision-test-roles.ps1 separately, then retry restore'
}

$databaseExists = Invoke-PsqlScalar -Database 'postgres' -Query @"
select case when exists (
  select 1 from pg_catalog.pg_database where datname = '$($script:DatabaseName)'
) then 'YES' else 'NO' end;
"@
if ($databaseExists -cne 'NO') {
    throw "REFUSED: restore target database already exists: $($script:DatabaseName)"
}

$postcheckFile = Join-Path $script:MigrationsRoot '015_backend_auth_foundation_POSTCHECK.sql'
Assert-RequiredFile -Path $postcheckFile

$createdTarget = $false
try {
    Invoke-CheckedNative -Command 'createdb' -Arguments @(
        "--host=$($script:DatabaseHost)",
        "--port=$($script:DatabasePort)",
        "--username=$($script:DatabaseUser)",
        '--maintenance-db=postgres',
        $script:DatabaseName
    )
    $createdTarget = $true

    $userObjectCount = Invoke-PsqlScalar -Query @'
select
  (select pg_catalog.count(*) from pg_catalog.pg_namespace n
   where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'public')
     and n.nspname !~ '^pg_(temp|toast_temp)_')
  + (select pg_catalog.count(*) from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       and n.nspname !~ '^pg_(temp|toast_temp)_')
  + (select pg_catalog.count(*) from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       and n.nspname !~ '^pg_(temp|toast_temp)_')
  + (select pg_catalog.count(*) from pg_catalog.pg_type t
     join pg_catalog.pg_namespace n on n.oid = t.typnamespace
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       and n.nspname !~ '^pg_(temp|toast_temp)_'
       and (
         not t.typisdefined
         or (
           t.typtype = 'b'
           and not exists (
             select 1 from pg_catalog.pg_type element_type
             where element_type.typarray = t.oid
           )
         )
         or t.typtype in ('d', 'e', 'r', 'm')
         or (
           t.typtype = 'c'
           and not exists (
             select 1 from pg_catalog.pg_class row_relation
             where row_relation.reltype = t.oid
               and row_relation.relkind in ('r', 'p', 'v', 'm', 'f')
           )
         )
       ))
  + (select pg_catalog.count(*) from pg_catalog.pg_extension where extname <> 'plpgsql')
  + (select pg_catalog.count(*) from pg_catalog.pg_operator o
     join pg_catalog.pg_namespace n on n.oid = o.oprnamespace
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       and n.nspname !~ '^pg_(temp|toast_temp)_')
  + (select pg_catalog.count(*) from pg_catalog.pg_collation c
     join pg_catalog.pg_namespace n on n.oid = c.collnamespace
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       and n.nspname !~ '^pg_(temp|toast_temp)_')
  + (select pg_catalog.count(*) from pg_catalog.pg_policy)
  + (select pg_catalog.count(*) from pg_catalog.pg_publication)
  + (select pg_catalog.count(*) from pg_catalog.pg_subscription);
'@
    if ($userObjectCount -cne '0') {
        throw "New restore target is unexpectedly non-empty: $userObjectCount objects"
    }

    $restoreArguments = (Get-ExplicitTargetArguments) + @(
        '--exit-on-error', '--single-transaction', $requiredFiles['database.dump']
    )
    Invoke-CheckedNative -Command 'pg_restore' -Arguments $restoreArguments
    Invoke-Psql -Arguments @('-X', '--set=ON_ERROR_STOP=1', "--file=$postcheckFile")
}
catch {
    if ($createdTarget) {
        [Console]::Error.WriteLine("Restore failed; test database preserved for diagnosis: $($script:DatabaseName)")
        [Console]::Error.WriteLine('Delete it only as a separate approved action after inspection.')
    }
    throw
}

Write-Host "Restore and POSTCHECK succeeded for new database: $($script:DatabaseName)"
