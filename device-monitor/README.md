# ExamGuard Windows Device Monitor

Windows-only local Companion for an authenticated ExamGuard attempt. It uses `BluetoothLEAdvertisementWatcher` for BLE advertisements and documented `wlanapi.dll` functions (`WlanScan` and `WlanGetNetworkBssList`) for Wi-Fi BSS/access-point observations.

## Automatic local connection

1. Build the app on Windows with the .NET 8 SDK:

   ```powershell
   dotnet publish .\device-monitor\ExamGuard.DeviceMonitor.csproj -c Release -r win-x64 --self-contained false
   ```

2. Run `.\device-monitor\Register-ExamGuard-Companion.ps1` once in PowerShell. Enter the institution's HTTPS API origin and website origin when prompted. The script installs the published files under `%LOCALAPPDATA%\ExamGuard\Companion`, registers a user-level Windows sign-in entry and the `examguard-companion:` launch protocol, and opens the Companion. No Administrator access is required.
3. Open ExamGuard and sign in as a student. The readiness screen checks the Companion and hosted AI service, tests the camera and microphone, and asks you to share **Entire screen / Monitor** in the browser picker. It rejects a shared tab or window when the browser exposes the selected surface type. Read the notice describing periodic full-display still images and give explicit consent before starting.
4. When the candidate starts an exam, the browser requests a short-lived attempt-scoped credential from the backend and sends it directly to the Companion over `127.0.0.1`. The token is never displayed or manually copied. The Companion verifies the credential against the backend, then starts consented scanning and sends heartbeats.
5. The backend does not release exam questions until the active attempt has a recent Companion heartbeat. The browser refreshes the ten-minute credential automatically while the attempt is active. Submission asks the local Companion to stop scanning.

## Candidate quick instructions

- Start or open **ExamGuard Device Monitor** before starting your exam. Keep it running through submission; the browser readiness page should say the Companion is connected.
- In the browser's screen-share picker select **Entire screen** or **Monitor**, not a tab or single app window. The browser displays a sharing indicator. ExamGuard uploads a full-display still every 15 seconds while the attempt is active; this is not continuous video.
- Keep one ExamGuard exam tab open and fullscreen. In supported browsers ExamGuard holds an exclusive browser lock for the attempt; duplicate ExamGuard exam tabs are blocked before Companion pairing or question release. Visibility, focus, and fullscreen changes are recorded as human-review signals. This does not close unrelated tabs, control other browser profiles, or lock Windows. Use a managed kiosk browser/device when enforced lockdown is required.
- To stop scanning, use the Companion's **Stop consented monitoring** button or submit the exam. Stopping screen sharing separately ends full-display evidence; notify the exam organizer if that was accidental.
- The Companion gathers consented Bluetooth/Wi-Fi observations for the attempt paired by the active ExamGuard tab. Wi-Fi access-point scans run at startup and then about once per minute while monitoring is active; a Windows scan may take up to four seconds to complete. It does not enforce the browser tab lock or record the desktop. Screen sharing and display stills are separate browser-controlled features.

The Companion starts automatically at Windows sign-in after registration. If it is not running, use **Open Windows Companion** on the readiness page; the browser may ask you to confirm launching the installed desktop app. The local bridge uses a loopback-only TCP listener on `127.0.0.1:43117`, accepts only the configured ExamGuard website origin, checks that its client is loopback, and only forwards credentials to the configured API origin.

Give students the steps in [the candidate exam setup guide](../docs/CANDIDATE_EXAM_GUIDE.md) and distribute the Companion only through the institution's trusted HTTPS download.

## Consent and device limitations

Monitoring consent is recorded in the authenticated exam attempt before a Companion credential can be issued. The local Companion automatically enables scanning only after it receives that consented browser handshake. The student can stop scanning from the Companion window at any time; the candidate UI reports this as a technical status, not proof of misconduct.

- BLE advertising does not identify device type. Phones may not advertise and addresses may rotate.
- Wi-Fi scanning sees access points/BSS entries, not connected clients or every nearby phone. A hotspot is not proof of a prohibited device.
- When a BLE advertisement includes a local name, the Companion sends a sanitized, length-limited label with its observation. Names are self-advertised and unverified; raw Bluetooth addresses and Wi-Fi BSSIDs remain in memory only and are converted to session-scoped pseudonyms before upload.
- ExamGuard shows source-specific Near/Medium/Far RSSI categories using configurable `RADIO_BLE_*_DBM` and `RADIO_WIFI_*_DBM` thresholds. Defaults are provisional examples, not site calibration and not distance estimates. Calibrate at the venue with the actual scanners; signal strength changes with hardware, orientation, walls, and interference.
- A Potential Visual Assistance review signal requires a camera-only screen readability heuristic and a recent near/medium BLE advertisement in the same attempt. Wi-Fi access-point RSSI is shown as context but does not support that flag. Camera and radio observations are correlated by time only; the system does not link them to the same device.
- YOLO detects only classes present in its configured weights. Standard YOLO COCO weights include phones, laptops, and TVs, but not tablets; a tablet class requires compatible custom weights. The visual heuristic does not run OCR, measure physical distance, or prove that text was readable or used.
- The app does not use monitor mode, packet capture, injection, or driver hacks.
- This prototype requires hardware validation on a supported Windows laptop. No physical-device testing was performed in the source-packaging environment.

## Unregister

Run `.\device-monitor\Unregister-ExamGuard-Companion.ps1` to remove the Windows sign-in and protocol entries. The loopback URL reservation is intentionally left intact.
