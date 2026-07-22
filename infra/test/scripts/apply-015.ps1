. (Join-Path $PSScriptRoot '_common.ps1')

Initialize-TestDbOperation -Action 'PRECHECK, apply migration 015, then POSTCHECK'
Assert-NativeCommand -Name 'psql'

if ($env:CONFIRM_APPLY_015 -cne 'APPLY_015_TO_CONFIRMED_EMPTY_TEST_DB') {
    throw 'REFUSED: set CONFIRM_APPLY_015=APPLY_015_TO_CONFIRMED_EMPTY_TEST_DB for this one apply'
}
Remove-Item -LiteralPath 'Env:CONFIRM_APPLY_015' -ErrorAction SilentlyContinue

$precheckFile = Join-Path $script:MigrationsRoot '015_backend_auth_foundation_PRECHECK.sql'
$migrationFile = Join-Path $script:MigrationsRoot '015_backend_auth_foundation.sql'
$postcheckFile = Join-Path $script:MigrationsRoot '015_backend_auth_foundation_POSTCHECK.sql'
Assert-RequiredFile -Path $precheckFile
Assert-RequiredFile -Path $migrationFile
Assert-RequiredFile -Path $postcheckFile

$markerDirectory = Join-Path ([System.IO.Path]::GetTempPath()) (
    'prosto-padel-precheck-' + [Guid]::NewGuid().ToString('D')
)
[void][System.IO.Directory]::CreateDirectory($markerDirectory)
$markerFile = Join-Path $markerDirectory 'precheck.marker'

try {
    Invoke-Psql -Arguments @('-X', '--set=ON_ERROR_STOP=1', "--file=$precheckFile")
    [System.IO.File]::WriteAllLines(
        $markerFile,
        @(
            "database=$($script:DatabaseName)",
            "host=$($script:DatabaseHost)",
            'utc_timestamp=' + [DateTime]::UtcNow.ToString(
                'yyyy-MM-ddTHH:mm:ssZ',
                [System.Globalization.CultureInfo]::InvariantCulture
            )
        ),
        [System.Text.UTF8Encoding]::new($false)
    )
    if (-not (Test-Path -LiteralPath $markerFile -PathType Leaf) -or
        (Get-Item -LiteralPath $markerFile).Length -eq 0) {
        throw 'PRECHECK marker was not created'
    }

    Remove-Item -LiteralPath $markerFile
    Invoke-Psql -Arguments @('-X', '--set=ON_ERROR_STOP=1', "--file=$migrationFile")

    try {
        Invoke-Psql -Arguments @('-X', '--set=ON_ERROR_STOP=1', "--file=$postcheckFile")
    } catch {
        [Console]::Error.WriteLine(
            'POSTCHECK failed after migration 015. No automatic rollback was attempted; manual diagnosis is required.'
        )
        throw
    }
    Write-Host 'Migration 015 apply and automatic POSTCHECK succeeded.'
} finally {
    if (Test-Path -LiteralPath $markerDirectory -PathType Container) {
        Remove-Item -LiteralPath $markerDirectory -Recurse
    }
}
