# ExamGuard Windows Device Monitor

Windows-only local Companion for an authenticated ExamGuard attempt. It uses `BluetoothLEAdvertisementWatcher` for BLE advertisements and documented `wlanapi.dll` functions (`WlanScan` and `WlanGetNetworkBssList`) for Wi-Fi BSS/access-point observations.

## Automatic local connection

1. Build the app on Windows with the .NET 8 SDK:

   ```powershell
   dotnet publish .\device-monitor\ExamGuard.DeviceMonitor.csproj -c Release -r win-x64 --self-contained false
   ```

2. Run `Register-ExamGuard-Companion.ps1` once from an Administrator PowerShell window. It reserves the loopback bridge URL, registers the Companion to start at Windows sign-in, and launches it.
3. Open ExamGuard in the local browser and sign in as a student. The readiness screen checks the Companion and AI service, asks for explicit monitoring consent, and captures the candidate's camera permission.
4. When the candidate starts an exam, the browser requests a short-lived attempt-scoped credential from the backend and sends it directly to the Companion over `127.0.0.1`. The token is never displayed or manually copied. The Companion verifies the credential against the backend, then starts consented scanning and sends heartbeats.
5. The backend does not release exam questions until the active attempt has a recent Companion heartbeat. The browser refreshes the ten-minute credential automatically while the attempt is active. Submission asks the local Companion to stop scanning.

The local bridge binds only to `127.0.0.1:43117`, accepts only the configured local browser origin, checks that its client is loopback, and only forwards credentials to the allowlisted local API origins. If the bridge cannot reserve its URL, run the registration script as Administrator.

## Consent and device limitations

Monitoring consent is recorded in the authenticated exam attempt before a Companion credential can be issued. The local Companion automatically enables scanning only after it receives that consented browser handshake. The student can stop scanning from the Companion window at any time; the candidate UI reports this as a technical status, not proof of misconduct.

- BLE advertising does not identify device type. Phones may not advertise and addresses may rotate.
- Wi-Fi scanning sees access points/BSS entries, not connected clients or every nearby phone. A hotspot is not proof of a prohibited device.
- The app does not use monitor mode, packet capture, injection, driver hacks, or raw address/BSSID storage. Identifiers are converted to session-scoped pseudonyms in memory before upload.
- This prototype requires hardware validation on a supported Windows laptop. No physical-device testing was performed in the source-packaging environment.

## Unregister

Run `Unregister-ExamGuard-Companion.ps1` to remove the Windows sign-in startup entry. The loopback URL reservation is intentionally left intact.
