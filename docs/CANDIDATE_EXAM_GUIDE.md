# Candidate exam setup guide

Share this guide and the institution-approved Windows Companion download with candidates before exam day. The AI service runs on the institution's host; candidates do not install it.

## Before exam day

1. Use a Windows 10/11 computer with a supported, up-to-date browser (Edge or Chrome recommended), a working camera and microphone, Bluetooth, and a stable internet connection.
2. Download the Windows Companion only from your institution's official link. Do not install a copy sent by an unknown person.
3. Close the browser. Run the provided `Register-ExamGuard-Companion.ps1` once. When asked, enter the ExamGuard API origin and the ExamGuard website origin exactly as provided by your institution (for example, `https://api.exam.example.edu` and `https://exam.example.edu`). No administrator access is required.
4. Open **ExamGuard Device Monitor** from the Start menu and leave it running. Windows may ask to allow Bluetooth or Wi-Fi scanning.
5. Sign in to ExamGuard, open a practice assessment if available, and complete every readiness check. Contact the institution before exam day if the Companion does not connect.

## On exam day

1. Plug in your computer, connect to reliable internet, and keep only the exam computer available.
2. Open ExamGuard and select **Start readiness** for your assigned exam.
3. Allow camera and microphone access when the browser asks. These permissions are used for the disclosed exam checks; audio is not recorded or uploaded.
4. Select **Open Windows Companion** if prompted and approve the browser's confirmation to open the installed app. Keep the Companion running.
5. Select **Share entire display**, then choose **Entire screen** or **Monitor** in the browser picker. Do not choose a tab or a single window.
6. Read the monitoring notice, complete the practice check, and select **Start secure exam** when every required item is ready. If fullscreen is required, the browser enters fullscreen when you start.
7. Keep the ExamGuard tab open. If you leave fullscreen, return using the on-screen button. Do not stop screen sharing or the Companion during the exam.
8. Select **Review and submit** when finished and wait for the submission receipt before closing the browser or Companion.

## If something goes wrong

- **Companion not connected:** Open Device Monitor, return to readiness, select **Open Windows Companion**, and retry. If it still fails, contact the exam organizer; do not repeatedly start the exam.
- **Camera or microphone blocked:** Select the browser's site-controls/lock icon, allow the requested device, reload the page, then run readiness again.
- **Screen sharing stopped:** Select **Share entire display** again if the exam has not started. During an exam, follow the on-screen warning and contact the organizer.
- **Exam start reports a server error:** Retry once. If it fails again, send the organizer the reference shown in the error. Do not create a second browser tab for the same exam.
- **No internet or computer issue:** Contact the organizer immediately using the institution's alternate contact method.

## Important limits

ExamGuard can require fullscreen, block its exam UI until fullscreen is restored, enforce one active ExamGuard exam tab in the current browser profile, and record supported tab/window focus events. A normal website cannot prevent operating-system shortcuts, switching to another app, using another device, or leaving the browser. Institutions that require enforced lockdown must configure and test managed Windows kiosk/Assigned Access devices before the exam. A signal is for human review and is not proof of misconduct.

The Companion is currently Windows-only. Its Bluetooth and Wi-Fi observations are best-effort technical signals, not proof that a particular device belongs to the candidate.
