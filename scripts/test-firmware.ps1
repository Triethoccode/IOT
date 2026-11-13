param(
    [string]$Compiler = 'g++',
    [string]$ArduinoJsonPath = 'esp32_aerodry/.pio/libdeps/esp32dev/ArduinoJson/src'
)
$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
Push-Location $repoPath
try {
    if (-not (Test-Path -LiteralPath $ArduinoJsonPath)) { throw 'Run PlatformIO build first to download ArduinoJson.' }
    New-Item -ItemType Directory -Path 'tmp' -Force | Out-Null
    & $Compiler '-std=c++17' '-I' 'tests/native/stubs' '-I' 'esp32_aerodry' '-I' $ArduinoJsonPath 'tests/native/firmware_test.cpp' '-o' 'tmp/firmware_test.exe'
    if ($LASTEXITCODE -ne 0) { throw 'Native C++ compilation failed' }
    & './tmp/firmware_test.exe'
    if ($LASTEXITCODE -ne 0) { throw 'Firmware tests failed' }
} finally { Pop-Location }
