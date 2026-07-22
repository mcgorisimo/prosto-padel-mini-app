. (Join-Path $PSScriptRoot '_common.ps1')

Initialize-TestDbOperation -Action 'rollback empty migration 015 foundation'
Assert-NativeCommand -Name 'psql'
if ($env:CONFIRM_ROLLBACK_015 -cne 'DROP_EMPTY_BACKEND_AUTH_SCHEMA') {
    throw 'REFUSED: set CONFIRM_ROLLBACK_015=DROP_EMPTY_BACKEND_AUTH_SCHEMA for this one rollback'
}
Remove-Item -LiteralPath 'Env:CONFIRM_ROLLBACK_015' -ErrorAction SilentlyContinue
$rollbackFile = Join-Path $script:MigrationsRoot '015_backend_auth_foundation_ROLLBACK.sql'
Assert-RequiredFile -Path $rollbackFile

$wrapperSql = @'
begin;
select pg_catalog.set_config(
  'backend_auth.rollback_015_confirm',
  'DROP_EMPTY_BACKEND_AUTH_015:' || pg_catalog.txid_current()::text,
  true
);
\ir 015_backend_auth_foundation_ROLLBACK.sql
'@

Push-Location -LiteralPath $script:MigrationsRoot
try {
    $arguments = (Get-ExplicitTargetArguments) + @('-X', '--set=ON_ERROR_STOP=1')
    $wrapperSql | & psql @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "psql failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}
