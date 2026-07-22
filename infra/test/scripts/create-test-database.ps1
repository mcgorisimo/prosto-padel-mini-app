. (Join-Path $PSScriptRoot '_common.ps1')

Initialize-TestDbOperation -Action 'create a new empty test database'
Assert-NativeCommand -Name 'psql'
Assert-NativeCommand -Name 'createdb'

$databaseExists = Invoke-PsqlScalar -Database 'postgres' -Query @"
select case when exists (
  select 1 from pg_catalog.pg_database where datname = '$($script:DatabaseName)'
) then 'YES' else 'NO' end;
"@
if ($databaseExists -cne 'NO') {
    throw "REFUSED: database already exists: $($script:DatabaseName)"
}

Invoke-CheckedNative -Command 'createdb' -Arguments @(
    "--host=$($script:DatabaseHost)",
    "--port=$($script:DatabasePort)",
    "--username=$($script:DatabaseUser)",
    '--maintenance-db=postgres',
    $script:DatabaseName
)
Write-Host "Created new test database: $($script:DatabaseName)"
