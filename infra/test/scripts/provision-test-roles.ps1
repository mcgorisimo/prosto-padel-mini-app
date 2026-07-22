. (Join-Path $PSScriptRoot '_common.ps1')

Initialize-TestDbOperation -Action 'provision migration 015 test roles'
Assert-NativeCommand -Name 'psql'
$provisionFile = Join-Path $script:TestRoot 'sql\000_provision_test_roles.sql'
Assert-RequiredFile -Path $provisionFile

if ([string]::IsNullOrWhiteSpace($env:BACKEND_AUTH_APP_PASSWORD) -or
    $env:BACKEND_AUTH_APP_PASSWORD.Length -lt 16) {
    throw 'REFUSED: BACKEND_AUTH_APP_PASSWORD must contain at least 16 characters and is never printed'
}

try {
    Invoke-Psql -Arguments @(
        '-X',
        '--set=ON_ERROR_STOP=1',
        "--variable=backend_auth_app_password=$($env:BACKEND_AUTH_APP_PASSWORD)",
        "--file=$provisionFile"
    )
} finally {
    Remove-Item -LiteralPath 'Env:BACKEND_AUTH_APP_PASSWORD' -ErrorAction SilentlyContinue
}
