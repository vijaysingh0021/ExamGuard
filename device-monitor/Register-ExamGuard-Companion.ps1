param(
    [string]$ApiUrl,
    [string]$ClientOrigin
)
$ErrorActionPreference = 'Stop'

function Read-ExamGuardOrigin([string]$Value, [string]$Label, [switch]$AllowLocalHttp) {
    try { $parsed = [uri]$Value } catch {
        throw "$Label must be an origin such as https://exam.example.edu, without a path."
    }
    if (-not $parsed.IsAbsoluteUri -or $parsed.AbsolutePath -ne '/' -or $parsed.Query -or $parsed.Fragment -or $parsed.UserInfo) {
        throw "$Label must be an origin such as https://exam.example.edu, without a path."
    }
    $isLocal = $parsed.Host -in @('localhost', '127.0.0.1', '::1')
    if ($parsed.Scheme -ne 'https' -and -not ($AllowLocalHttp -and $isLocal -and $parsed.Scheme -eq 'http')) {
        throw "$Label must use HTTPS. HTTP is allowed only for localhost development."
    }
    return $parsed.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
}

if ([string]::IsNullOrWhiteSpace($ApiUrl)) { $ApiUrl = Read-Host 'ExamGuard API origin (for example https://api.exam.example.edu)' }
if ([string]::IsNullOrWhiteSpace($ClientOrigin)) { $ClientOrigin = Read-Host 'ExamGuard website origin (for example https://exam.example.edu)' }
$ApiUrl = Read-ExamGuardOrigin $ApiUrl 'API URL' -AllowLocalHttp
$ClientOrigin = Read-ExamGuardOrigin $ClientOrigin 'Website URL' -AllowLocalHttp

$publishDirectory = Join-Path $PSScriptRoot 'bin\Release\net8.0-windows10.0.19041.0\win-x64\publish'
$publishedExecutable = Join-Path $publishDirectory 'ExamGuard.DeviceMonitor.exe'
if (-not (Test-Path -LiteralPath $publishedExecutable -PathType Leaf)) {
    throw "Companion executable not found at '$publishedExecutable'. Publish the app first using the command in README.md."
}

$installDirectory = Join-Path $env:LOCALAPPDATA 'ExamGuard\Companion'
$runningCompanions = Get-Process -Name 'ExamGuard.DeviceMonitor' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq (Join-Path $installDirectory 'ExamGuard.DeviceMonitor.exe') }
foreach ($runningCompanion in $runningCompanions) {
    Stop-Process -Id $runningCompanion.Id -ErrorAction Stop
    Wait-Process -Id $runningCompanion.Id -Timeout 10 -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 500
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Copy-Item -Path (Join-Path $publishDirectory '*') -Destination $installDirectory -Recurse -Force
$executable = Join-Path $installDirectory 'ExamGuard.DeviceMonitor.exe'

$settingsKey = 'HKCU:\Software\ExamGuard\Companion'
New-Item -Path $settingsKey -Force | Out-Null
New-ItemProperty -Path $settingsKey -Name 'ApiUrl' -PropertyType String -Value $ApiUrl -Force | Out-Null
New-ItemProperty -Path $settingsKey -Name 'ClientOrigin' -PropertyType String -Value $ClientOrigin -Force | Out-Null

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-ItemProperty -Path $runKey -Name 'ExamGuardDeviceMonitor' -PropertyType String -Value "`"$executable`"" -Force | Out-Null

$protocolKey = 'HKCU:\Software\Classes\examguard-companion'
New-Item -Path $protocolKey -Force | Out-Null
Set-Item -Path $protocolKey -Value 'URL:ExamGuard Windows Companion'
New-ItemProperty -Path $protocolKey -Name 'URL Protocol' -PropertyType String -Value '' -Force | Out-Null
$commandKey = Join-Path $protocolKey 'shell\open\command'
New-Item -Path $commandKey -Force | Out-Null
Set-Item -Path $commandKey -Value "`"$executable`" `"%1`""

Start-Process -FilePath $executable
Write-Output "ExamGuard Companion is installed for this Windows user and configured for $ClientOrigin. It starts at sign-in and can be opened from the exam readiness page. No Administrator access is required."
