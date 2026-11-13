$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
$email = Read-Host 'Local demo account email'
if ([string]::IsNullOrWhiteSpace($email)) { throw 'Email is required' }
$securePassword = Read-Host 'Password (at least 12 characters)' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$previousOutputEncoding = $OutputEncoding
try {
    $OutputEncoding = [Text.UTF8Encoding]::new($false)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $passwordHash = $plainPassword | node (Join-Path $repoPath 'scripts/hash-control-password.js')
    if ($LASTEXITCODE -ne 0) { throw 'Password hashing failed' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    $plainPassword = $null
    $OutputEncoding = $previousOutputEncoding
}
$config = @{ email = $email; passwordHash = $passwordHash.Trim() }
$configPath = Join-Path $repoPath 'nodered_data/control.local.json'
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Write-Host 'Saved local account configuration (gitignored). Run npm start.'
