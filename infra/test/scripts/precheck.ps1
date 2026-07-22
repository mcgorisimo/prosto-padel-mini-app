. (Join-Path $PSScriptRoot '_common.ps1')

Initialize-TestDbOperation -Action 'migration 015 PRECHECK (read-only)'
Assert-NativeCommand -Name 'psql'
$precheckFile = Join-Path $script:MigrationsRoot '015_backend_auth_foundation_PRECHECK.sql'
Assert-RequiredFile -Path $precheckFile

Invoke-Psql -Arguments @(
    '-X',
    '--set=ON_ERROR_STOP=1',
    "--file=$precheckFile"
)
