# ExamGuard Windows Device Monitor

Windows-only prototype companion for an authenticated active ExamGuard attempt. It uses `BluetoothLEAdvertisementWatcher` for BLE advertisements and documented `wlanapi.dll` functions (`WlanScan` and `WlanGetNetworkBssList`) for Wi-Fi BSS/access-point observations.

## Run

Install the .NET 8 SDK and build on a Windows laptop:

```powershell
dotnet run --project device-monitor/ExamGuard.DeviceMonitor.csproj
```

From the active exam, create a short-lived companion pairing token, paste it into the companion, and choose **Verify pairing**. The server supplies the organization, exam, candidate, and attempt context only after it verifies the active attempt. Read and accept the consent disclosure before scanning. The companion stores no raw address/BSSID locally: it hashes identifiers with a new in-memory session salt before upload. Stop ends scanning and rotates that salt.

## Limitations

- BLE advertising does not identify device type. Phones may not advertise and addresses may rotate.
- Wi-Fi scanning sees access points/BSS entries, not connected clients or every nearby phone. A hotspot is not proof of a prohibited device.
- The app does not use monitor mode, packet capture, injection, driver hacks, or elevated permissions.
- The prototype needs hardware validation on a supported Windows laptop. No physical-device testing was performed in this repository environment.
