using System.Security.Cryptography;
using System.Text;
using Windows.Devices.Bluetooth.Advertisement;

namespace ExamGuard.DeviceMonitor;

internal static class Program
{
    [STAThread]
    static void Main() { ApplicationConfiguration.Initialize(); Application.Run(new MonitorForm()); }
}

internal sealed class MonitorForm : Form
{
    private readonly TextBox apiUrl = new() { Text = "http://localhost:4000" };
    private readonly TextBox token = new() { UseSystemPasswordChar = true };
    private readonly TextBox organizationId = new(); private readonly TextBox examId = new(); private readonly TextBox candidateId = new(); private readonly TextBox attemptId = new();
    private readonly Label bluetoothStatus = new() { Text = "Bluetooth: stopped" }; private readonly Label wifiStatus = new() { Text = "Wi-Fi: stopped" }; private readonly ListBox activity = new() { Dock = DockStyle.Fill };
    private readonly BluetoothLEAdvertisementWatcher bluetooth = new(); private readonly HttpClient http = new(); private string sessionSalt = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)); private bool consented;
    public MonitorForm()
    {
        Text = "ExamGuard Device Monitor"; Width = 760; Height = 560; MinimumSize = new Size(560, 480);
        var fields = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, Padding = new Padding(12) };
        void Field(string label, Control control) { fields.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left }); control.Dock = DockStyle.Fill; fields.Controls.Add(control); }
        Field("API URL", apiUrl); Field("Exam access token", token); Field("Organization ID", organizationId); Field("Exam ID", examId); Field("Candidate ID", candidateId); Field("Attempt ID", attemptId);
        var consent = new CheckBox { Text = "I understand this app observes BLE advertisements and Wi-Fi access points only. It cannot identify every nearby phone or connected client.", AutoSize = true };
        consent.CheckedChanged += (_, _) => consented = consent.Checked;
        var start = new Button { Text = "Start consented scan", AutoSize = true }; start.Click += async (_, _) => await StartAsync(); var stop = new Button { Text = "Stop and end session", AutoSize = true }; stop.Click += async (_, _) => await StopAsync();
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(12) }; buttons.Controls.Add(start); buttons.Controls.Add(stop); buttons.Controls.Add(bluetoothStatus); buttons.Controls.Add(wifiStatus);
        Controls.Add(activity); Controls.Add(buttons); Controls.Add(consent); Controls.Add(fields);
        bluetooth.Received += async (_, e) => await BluetoothReceived(e);
    }
    private async Task StartAsync()
    {
        if (!consented) { Add("Scanning is unavailable until informed consent is checked."); return; }
        if (string.IsNullOrWhiteSpace(token.Text) || string.IsNullOrWhiteSpace(organizationId.Text) || string.IsNullOrWhiteSpace(examId.Text) || string.IsNullOrWhiteSpace(candidateId.Text) || string.IsNullOrWhiteSpace(attemptId.Text)) { Add("Pairing fields are required; use only a short-lived ExamGuard exam token."); return; }
        try { bluetooth.Start(); bluetoothStatus.Text = "Bluetooth: active"; Add("BLE watcher started. Addresses are pseudonymized locally and may rotate."); await Submit("scanner_health", "scan_unavailable", null, null, "unavailable"); }
        catch (Exception ex) { bluetoothStatus.Text = "Bluetooth: unavailable"; Add($"Bluetooth API unavailable: {ex.HResult:X}"); await Submit("scanner_health", "scan_error", null, ex.HResult.ToString("X"), "error"); }
        await ScanWifiAsync();
    }
    private async Task BluetoothReceived(BluetoothLEAdvertisementReceivedEventArgs e)
    {
        var pseudonym = Pseudonym(e.BluetoothAddress.ToString("X")); Add($"BLE advertisement observed (RSSI {e.RawSignalStrengthInDBm} dBm); device type unknown."); await Submit("bluetooth_le", "advertisement", e.RawSignalStrengthInDBm, null, "active", pseudonym);
    }
    private async Task ScanWifiAsync()
    {
        try { var results = NativeWifi.Scan(); wifiStatus.Text = $"Wi-Fi: active ({results.Count} access points)"; foreach (var ap in results.Take(20)) { Add($"Wi-Fi access point observed (RSSI {ap.Rssi} dBm); not a client/phone determination."); await Submit("wifi", "access_point", ap.Rssi, null, "active", Pseudonym(ap.Bssid)); } }
        catch (Exception ex) { wifiStatus.Text = "Wi-Fi: unavailable"; Add($"Wi-Fi scan unavailable: {ex.Message}"); await Submit("scanner_health", "scan_error", null, "wifi_api_error", "error"); }
    }
    private async Task StopAsync() { if (bluetooth.Status == BluetoothLEAdvertisementWatcherStatus.Started) bluetooth.Stop(); bluetoothStatus.Text = "Bluetooth: stopped"; wifiStatus.Text = "Wi-Fi: stopped"; await Submit("scanner_health", "scan_stopped", null, null, "stopped"); Add("Scanning stopped by student."); sessionSalt = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)); }
    private string Pseudonym(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sessionSalt + value))).ToLowerInvariant();
    private async Task Submit(string source, string kind, int? rssi, string? errorCode, string status, string? pseudonym = null)
    {
        try { var payload = new { organizationId = organizationId.Text, examId = examId.Text, candidateId = candidateId.Text, attemptId = attemptId.Text, source, kind, rssi, pseudonym, scannerStatus = status, errorCode }; using var request = new HttpRequestMessage(HttpMethod.Post, $"{apiUrl.Text.TrimEnd('/')}/api/student/radio-observations") { Content = JsonContent.Create(payload) }; request.Headers.Authorization = new("Bearer", token.Text); await http.SendAsync(request); } catch { Add("Observation could not be uploaded; no local raw identifier is retained."); }
    }
    private void Add(string message) { if (InvokeRequired) { BeginInvoke(() => Add(message)); return; } activity.Items.Insert(0, $"{DateTime.Now:T}  {message}"); }
}
