
using System;
using System.Drawing;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;

namespace ExamGuard.DeviceMonitor;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MonitorForm());
    }
}

internal sealed class MonitorForm : Form
{
    private readonly TextBox apiUrl = new()
    {
        Text = "http://localhost:4000"
    };

    private readonly TextBox pairingToken = new()
    {
        UseSystemPasswordChar = true
    };

    private readonly TextBox organizationId = new();
    private readonly TextBox examId = new();
    private readonly TextBox candidateId = new();
    private readonly TextBox attemptId = new();

    private readonly Button pairButton = new()
    {
        Text = "Verify pairing",
        AutoSize = true
    };

    private readonly Label bluetoothStatus = new()
    {
        Text = "Bluetooth: stopped",
        AutoSize = true
    };

    private readonly Label wifiStatus = new()
    {
        Text = "Wi-Fi: stopped",
        AutoSize = true
    };

    private readonly ListBox activity = new()
    {
        Dock = DockStyle.Fill
    };

    private readonly CheckBox consent = new()
    {
        Text = "I consent to this session's BLE and Wi-Fi access-point observations.",
        AutoSize = true,
        Padding = new Padding(8)
    };

    private readonly Button startButton = new()
    {
        Text = "Start consented scan",
        AutoSize = true
    };

    private readonly Button stopButton = new()
    {
        Text = "Stop and end session",
        AutoSize = true
    };

    private readonly BluetoothLEAdvertisementWatcher bluetooth = new();
    private readonly HttpClient http = new()
    {
        Timeout = TimeSpan.FromSeconds(10)
    };

    private string sessionSalt =
        Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

    private bool scanning;
    private bool closing;
    private bool wifiScanRunning;
    private bool paired;
    private DateTimeOffset? pairingExpiresAt;

    public MonitorForm()
    {
        Text = "ExamGuard Device Monitor";
        Width = 800;
        Height = 620;
        MinimumSize = new Size(600, 500);
        StartPosition = FormStartPosition.CenterScreen;

        var fields = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 2,
            Padding = new Padding(12)
        };

        fields.ColumnStyles.Add(
            new ColumnStyle(SizeType.AutoSize));

        fields.ColumnStyles.Add(
            new ColumnStyle(SizeType.Percent, 100));

        void AddField(string label, Control control)
        {
            fields.Controls.Add(new Label
            {
                Text = label,
                AutoSize = true,
                Anchor = AnchorStyles.Left,
                Padding = new Padding(0, 5, 8, 5)
            });

            control.Dock = DockStyle.Fill;
            fields.Controls.Add(control);
        }

        AddField("API URL", apiUrl);
        AddField("Short-lived pairing token", pairingToken);

        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            Padding = new Padding(8)
        };

        buttons.Controls.Add(pairButton);
        buttons.Controls.Add(startButton);
        buttons.Controls.Add(stopButton);
        buttons.Controls.Add(bluetoothStatus);
        buttons.Controls.Add(wifiStatus);

        var consentPanel = new Panel
        {
            Dock = DockStyle.Top,
            AutoSize = true
        };

        consentPanel.Controls.Add(consent);

        Controls.Add(activity);
        Controls.Add(buttons);
        Controls.Add(consentPanel);
        Controls.Add(fields);

        startButton.Click += async (_, _) =>
            await StartAsync();

        pairButton.Click += async (_, _) =>
            await PairAsync();

        pairingToken.TextChanged += (_, _) =>
        {
            paired = false;
            pairingExpiresAt = null;
        };

        stopButton.Click += async (_, _) =>
            await StopAsync();

        bluetooth.Received += async (_, e) =>
            await BluetoothReceived(e);

        bluetooth.Stopped += (_, e) =>
        {
            if (e.Error != BluetoothError.Success)
            {
                SetBluetoothStatus("Bluetooth: unavailable");
                Add($"Bluetooth stopped with error: {e.Error}");
            }
        };

        consent.CheckedChanged += (_, _) =>
        {
            if (!consent.Checked && scanning)
            {
                Add("Consent withdrawn; stopping scan.");
                _ = StopAsync();
            }
        };

        FormClosing += async (_, e) =>
        {
            if (scanning && !closing)
            {
                e.Cancel = true;
                await StopAsync();
                closing = true;
                Close();
            }
        };
    }

    private async Task StartAsync()
    {
        if (scanning)
        {
            Add("A scan session is already active.");
            return;
        }

        if (!consent.Checked)
        {
            Add("Please provide consent before scanning.");
            return;
        }

        if (!Uri.TryCreate(
                apiUrl.Text.Trim(),
                UriKind.Absolute,
                out var apiUri) ||
            (apiUri.Scheme != Uri.UriSchemeHttp &&
             apiUri.Scheme != Uri.UriSchemeHttps))
        {
            Add("Enter a valid HTTP or HTTPS API URL.");
            return;
        }

        if (!paired || string.IsNullOrWhiteSpace(pairingToken.Text) ||
            string.IsNullOrWhiteSpace(organizationId.Text) ||
            string.IsNullOrWhiteSpace(examId.Text) ||
            string.IsNullOrWhiteSpace(candidateId.Text) ||
            string.IsNullOrWhiteSpace(attemptId.Text))
        {
            Add("Verify the short-lived pairing token before starting a scan.");
            return;
        }

        scanning = true;
        startButton.Enabled = false;
        stopButton.Enabled = true;

        sessionSalt =
            Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

        Add("Starting consented scan session.");

        try
        {
            bluetooth.Start();

            SetBluetoothStatus("Bluetooth: active");
            Add("Bluetooth LE watcher started.");
        }
        catch (Exception ex)
        {
            SetBluetoothStatus("Bluetooth: unavailable");
            Add($"Bluetooth could not start: {ex.HResult:X8}");

            await Submit(
                "scanner_health",
                "scan_error",
                null,
                ex.HResult.ToString("X8"),
                "error");
        }

        await ScanWifiAsync();

        if (scanning)
        {
            await Submit(
                "scanner_health",
                "scan_unavailable",
                null,
                null,
                "active");

            Add("Initial scan completed. BLE observations continue while scanning is active.");
        }
    }

    private async Task PairAsync()
    {
        if (!Uri.TryCreate(apiUrl.Text.Trim(), UriKind.Absolute, out var apiUri) ||
            (apiUri.Scheme != Uri.UriSchemeHttp && apiUri.Scheme != Uri.UriSchemeHttps))
        {
            Add("Enter a valid HTTP or HTTPS API URL.");
            return;
        }
        if (string.IsNullOrWhiteSpace(pairingToken.Text))
        {
            Add("Paste the short-lived pairing token from the active exam.");
            return;
        }
        pairButton.Enabled = false;
        try
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Get,
                $"{apiUrl.Text.TrimEnd('/')}/api/student/companion-pairing");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", pairingToken.Text.Trim());
            using var response = await http.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                paired = false;
                Add($"Pairing was not accepted ({(int)response.StatusCode}). Return to the active exam and create a new token.");
                return;
            }
            var payload = await response.Content.ReadFromJsonAsync<PairingResponse>();
            if (payload?.Context is null || string.IsNullOrWhiteSpace(payload.Context.OrganizationId) ||
                string.IsNullOrWhiteSpace(payload.Context.ExamId) || string.IsNullOrWhiteSpace(payload.Context.CandidateId) ||
                string.IsNullOrWhiteSpace(payload.Context.AttemptId))
            {
                paired = false;
                Add("Pairing response did not contain a usable exam context.");
                return;
            }
            organizationId.Text = payload.Context.OrganizationId;
            examId.Text = payload.Context.ExamId;
            candidateId.Text = payload.Context.CandidateId;
            attemptId.Text = payload.Context.AttemptId;
            pairingExpiresAt = payload.ExpiresAt;
            paired = true;
            Add($"Pairing verified. Token expires {pairingExpiresAt?.ToLocalTime().ToString("t") ?? "soon"}.");
        }
        catch (TaskCanceledException)
        {
            paired = false;
            Add("Pairing check timed out. Check that the API is running.");
        }
        catch (HttpRequestException ex)
        {
            paired = false;
            Add($"Pairing network/API error: {ex.Message}");
        }
        finally
        {
            pairButton.Enabled = true;
        }
    }

    private async Task BluetoothReceived(
        BluetoothLEAdvertisementReceivedEventArgs e)
    {
        if (!scanning || !consent.Checked)
            return;

        // The raw Bluetooth address is used only in memory to
        // derive a session-scoped pseudonym. It is never uploaded.
        var pseudonym = Pseudonym(e.BluetoothAddress.ToString("X"));

        Add(
            $"BLE advertisement observed (RSSI {e.RawSignalStrengthInDBm} dBm). " +
            "Device identity and device type are unknown.");

        await Submit(
            "bluetooth_le",
            "advertisement",
            e.RawSignalStrengthInDBm,
            null,
            "active",
            pseudonym);
    }

    private async Task ScanWifiAsync()
    {
        if (!scanning || wifiScanRunning)
            return;

        wifiScanRunning = true;

        try
        {
            // NativeWifi is the existing helper in this project.
            var results = NativeWifi.Scan();

            SetWifiStatus(
                $"Wi-Fi: scan completed ({results.Count} access points)");

            foreach (var ap in results.Take(20))
            {
                if (!scanning || !consent.Checked)
                    break;

                Add(
                    $"Wi-Fi access point observed (RSSI {ap.Rssi} dBm). " +
                    "This does not identify a nearby phone or client.");

                await Submit(
                    "wifi",
                    "access_point",
                    ap.Rssi,
                    null,
                    "active",
                    Pseudonym(ap.Bssid));
            }
        }
        catch (Exception ex)
        {
            SetWifiStatus("Wi-Fi: unavailable");
            Add($"Wi-Fi scan failed: {ex.Message}");

            await Submit(
                "scanner_health",
                "scan_error",
                null,
                "wifi_api_error",
                "error");
        }
        finally
        {
            wifiScanRunning = false;
        }
    }

    private async Task StopAsync()
    {
        if (!scanning)
            return;

        scanning = false;
        startButton.Enabled = true;
        stopButton.Enabled = false;

        try
        {
            if (bluetooth.Status ==
                BluetoothLEAdvertisementWatcherStatus.Started)
            {
                bluetooth.Stop();
            }
        }
        catch (Exception ex)
        {
            Add($"Error stopping Bluetooth watcher: {ex.Message}");
        }

        SetBluetoothStatus("Bluetooth: stopped");
        SetWifiStatus("Wi-Fi: stopped");

        await Submit(
            "scanner_health",
            "scan_stopped",
            null,
            null,
            "stopped");

        Add("Scanning stopped by user. Session ended.");

        // Rotate the salt so pseudonyms from a later session
        // cannot be linked using the same session salt.
        sessionSalt =
            Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    }

    private string Pseudonym(string value)
    {
        return Convert.ToHexString(
            SHA256.HashData(
                Encoding.UTF8.GetBytes(sessionSalt + value)))
            .ToLowerInvariant();
    }

    private async Task Submit(
        string source,
        string kind,
        int? rssi,
        string? errorCode,
        string status,
        string? pseudonym = null)
    {
        try
        {
            var payload = new
            {
                organizationId = organizationId.Text.Trim(),
                examId = examId.Text.Trim(),
                candidateId = candidateId.Text.Trim(),
                attemptId = attemptId.Text.Trim(),
                source,
                kind,
                rssi,
                pseudonym,
                scannerStatus = status,
                errorCode
            };

            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                $"{apiUrl.Text.TrimEnd('/')}/api/student/radio-observations")
            {
                Content = JsonContent.Create(payload)
            };

            request.Headers.Authorization =
                new AuthenticationHeaderValue(
                    "Bearer",
                    pairingToken.Text.Trim());

            using var response = await http.SendAsync(request);

            var responseBody =
                await response.Content.ReadAsStringAsync();

            Add(
                $"Upload: {(int)response.StatusCode} " +
                $"{response.StatusCode}");

            if (!response.IsSuccessStatusCode)
            {
                // Avoid printing tokens or raw radio identifiers.
                Add($"Server response: {Limit(responseBody, 500)}");
            }
        }
        catch (TaskCanceledException)
        {
            Add("Upload timed out. Check that the API is running.");
        }
        catch (HttpRequestException ex)
        {
            Add($"Network/API error: {ex.Message}");
        }
        catch (Exception ex)
        {
            Add($"Upload error: {ex.GetType().Name}: {ex.Message}");
        }
    }

    private static string Limit(string value, int maxLength)
    {
        if (string.IsNullOrEmpty(value))
            return "(empty response)";

        return value.Length <= maxLength
            ? value
            : value[..maxLength] + "...";
    }

    private void SetBluetoothStatus(string value)
    {
        if (InvokeRequired)
        {
            BeginInvoke(() => SetBluetoothStatus(value));
            return;
        }

        bluetoothStatus.Text = value;
    }

    private void SetWifiStatus(string value)
    {
        if (InvokeRequired)
        {
            BeginInvoke(() => SetWifiStatus(value));
            return;
        }

        wifiStatus.Text = value;
    }

    private void Add(string message)
    {
        if (IsDisposed || Disposing)
            return;

        if (InvokeRequired)
        {
            BeginInvoke(() => Add(message));
            return;
        }

        activity.Items.Insert(
            0,
            $"{DateTime.Now:T}  {message}");
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            if (bluetooth.Status == BluetoothLEAdvertisementWatcherStatus.Started)
                bluetooth.Stop();
            http.Dispose();
        }

        base.Dispose(disposing);
    }
}

internal sealed class PairingResponse
{
    public PairingContext? Context { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
}

internal sealed class PairingContext
{
    public string OrganizationId { get; set; } = "";
    public string ExamId { get; set; } = "";
    public string CandidateId { get; set; } = "";
    public string AttemptId { get; set; } = "";
}
