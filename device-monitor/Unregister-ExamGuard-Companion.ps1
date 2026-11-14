$ErrorActionPreference = 'Stop'

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Remove-ItemProperty -Path $runKey -Name 'ExamGuardDeviceMonitor' -ErrorAction SilentlyContinue
Remove-Item -Path 'HKCU:\Software\Classes\examguard-companion' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path 'HKCU:\Software\ExamGuard\Companion' -Recurse -Force -ErrorAction SilentlyContinue
Write-Output 'Removed the ExamGuard Companion sign-in and protocol entries.'
