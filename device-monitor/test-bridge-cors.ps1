$ErrorActionPreference = "Stop"

$origin = "https://examguard-sooty.vercel.app"
$url = "http://127.0.0.1:43117"
$appPath = Join-Path $PSScriptRoot "bin\Debug\net8.0-windows10.0.19041.0\ExamGuard.DeviceMonitor.exe"

if (-not (Test-Path $appPath)) {
    throw "Build the Companion first with: dotnet build `"$PSScriptRoot\ExamGuard.DeviceMonitor.csproj`""
}

$existingConnection = Get-NetTCPConnection -State Listen -LocalPort 43117 -ErrorAction SilentlyContinue
if ($existingConnection) {
    throw "Port 43117 is already in use. Close the existing Companion before running this isolated test."
}

$previousOrigin = [Environment]::GetEnvironmentVariable("EXAMGUARD_CLIENT_ORIGIN", "Process")
$testProcess = $null
Add-Type -AssemblyName System.Net.Http
$httpClient = [System.Net.Http.HttpClient]::new()

try {
    [Environment]::SetEnvironmentVariable("EXAMGUARD_CLIENT_ORIGIN", $origin, "Process")
    $testProcess = Start-Process -FilePath $appPath -WorkingDirectory $PSScriptRoot -PassThru

    $ready = $false
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        if ($testProcess.HasExited) {
            throw "The Companion test process exited before starting its local bridge."
        }
        try {
            $probe = [System.Net.Sockets.TcpClient]::new()
            $probe.Connect("127.0.0.1", 43117)
            $probe.Dispose()
            $ready = $true
            break
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
    if (-not $ready) {
        throw "The Companion test process did not start its local bridge."
    }

    $preflight = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::Options,
        "$url/health"
    )
    [void]$preflight.Headers.TryAddWithoutValidation("Origin", $origin)
    [void]$preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "GET")
    [void]$preflight.Headers.TryAddWithoutValidation(
        "Access-Control-Request-Headers",
        "authorization, content-type"
    )
    [void]$preflight.Headers.TryAddWithoutValidation(
        "Access-Control-Request-Private-Network",
        "true"
    )
    $preflightResponse = $httpClient.SendAsync($preflight).GetAwaiter().GetResult()
    if ([int]$preflightResponse.StatusCode -ne 204) {
        throw "Expected OPTIONS 204; received $([int]$preflightResponse.StatusCode)."
    }
    if ($preflightResponse.Headers.GetValues("Access-Control-Allow-Origin") -notcontains $origin) {
        throw "OPTIONS did not allow the exact configured production origin."
    }
    $allowedHeaders = $preflightResponse.Headers.GetValues("Access-Control-Allow-Headers") -join ","
    if ($allowedHeaders -notmatch "(?i)(^|,)\s*Authorization\s*(,|$)" -or
        $allowedHeaders -notmatch "(?i)(^|,)\s*Content-Type\s*(,|$)") {
        throw "OPTIONS did not allow both Authorization and Content-Type."
    }
    if ($preflightResponse.Headers.GetValues("Access-Control-Allow-Private-Network") -notcontains "true") {
        throw "OPTIONS did not allow Private Network Access."
    }
    Write-Output "PASS: production-origin OPTIONS allows Authorization, Content-Type, and Private Network Access."

    $unauthorized = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::Get,
        "$url/health"
    )
    [void]$unauthorized.Headers.TryAddWithoutValidation("Origin", $origin)
    $unauthorizedResponse = $httpClient.SendAsync($unauthorized).GetAwaiter().GetResult()
    if ([int]$unauthorizedResponse.StatusCode -ne 401) {
        throw "Expected unauthenticated health request to return 401; received $([int]$unauthorizedResponse.StatusCode)."
    }
    Write-Output "PASS: health endpoint rejects requests without a Bearer token."

    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $tokenBytes = New-Object byte[] 32
    $random.GetBytes($tokenBytes)
    $testToken = [BitConverter]::ToString($tokenBytes).Replace("-", "")
    $random.Dispose()

    $health = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::Get,
        "$url/health"
    )
    [void]$health.Headers.TryAddWithoutValidation("Origin", $origin)
    $health.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new(
        "Bearer",
        $testToken
    )
    $healthResponse = $httpClient.SendAsync($health).GetAwaiter().GetResult()
    if ([int]$healthResponse.StatusCode -ne 200) {
        throw "Expected authenticated health request to return 200; received $([int]$healthResponse.StatusCode)."
    }
    $healthBody = $healthResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
    if ($healthBody.status -ne "ready" -or $healthBody.paired -ne $false -or $healthBody.scanning -ne $false) {
        throw "Health response did not report the actual idle Companion state."
    }
    Write-Output "PASS: authenticated production-origin health request returns ready, paired=false, scanning=false."

    $untrusted = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::Options,
        "$url/health"
    )
    [void]$untrusted.Headers.TryAddWithoutValidation("Origin", "https://untrusted.example")
    [void]$untrusted.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "GET")
    [void]$untrusted.Headers.TryAddWithoutValidation(
        "Access-Control-Request-Headers",
        "authorization, content-type"
    )
    $untrustedResponse = $httpClient.SendAsync($untrusted).GetAwaiter().GetResult()
    if ([int]$untrustedResponse.StatusCode -ne 403) {
        throw "Expected an untrusted-origin request to return 403; received $([int]$untrustedResponse.StatusCode)."
    }
    Write-Output "PASS: untrusted origin remains rejected."
} finally {
    $httpClient.Dispose()
    [Environment]::SetEnvironmentVariable("EXAMGUARD_CLIENT_ORIGIN", $previousOrigin, "Process")
    if ($testProcess -and -not $testProcess.HasExited) {
        $testProcess.CloseMainWindow() | Out-Null
        if (-not $testProcess.WaitForExit(5000)) {
            Stop-Process -Id $testProcess.Id -Force
        }
    }
}
