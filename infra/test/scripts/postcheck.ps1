. (Join-Path $PSScriptRoot '_common.ps1')

Initialize-TestDbOperation -Action 'migration 015 POSTCHECK (read-only)'
Assert-NativeCommand -Name 'psql'
$postcheckFile = Join-Path $script:MigrationsRoot '015_backend_auth_foundation_POSTCHECK.sql'
Assert-RequiredFile -Path $postcheckFile

Invoke-Psql -Arguments @(
    '-X',
    '--set=ON_ERROR_STOP=1',
    "--file=$postcheckFile"
)
