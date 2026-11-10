
using System;
using System.Drawing;
using System.Linq;
using System.Net.Http;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
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
        Text = "Stop monitoring",
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
    private bool bluetoothAvailable;
    private bool wifiAvailable;
    private bool paired;
    private DateTimeOffset? pairingExpiresAt;

    private const string BridgePrefix = "http://127.0.0.1:43117/";
    private readonly HttpListener bridge = new();
    private readonly CancellationTokenSource bridgeCancellation = new();
    private Task? bridgeTask;
    private System.Threading.Timer? heartbeatTimer;

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

        apiUrl.ReadOnly = true;
        AddField("ExamGuard API", apiUrl);
        pairingToken.Visible = false;
        pairButton.Visible = false;
        startButton.Visible = false; // Monitoring is started only by an authenticated browser handshake.

        var bridgeNote = new Label
        {
            Text = "Automatic local connection is enabled. Open an exam in ExamGuard; the browser will securely connect this Companion to that attempt. Consent is required before scanning.",
            AutoSize = true,
            MaximumSize = new Size(740, 0),
            Padding = new Padding(12)
        };

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
        Controls.Add(bridgeNote);
        Controls.Add(fields);

        Shown += async (_, _) => await StartLocalBridgeAsync();

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

    private async Task<bool> StartAsync()
    {
        if (!paired ||
            !pairingExpiresAt.HasValue ||
            pairingExpiresAt.Value <= DateTimeOffset.UtcNow.AddSeconds(30))
        {
            paired = false;
            Add("Pairing is missing or expired. Monitoring cannot start.");
            if (scanning)
                await StopAsync(reportToServer: false);
            return false;
        }

        if (scanning)
        {
            Add("A scan session is already active.");
            return true;
        }

        if (!consent.Checked)
        {
            Add("Please provide consent before scanning.");
            return false;
        }

        if (!Uri.TryCreate(
                apiUrl.Text.Trim(),
                UriKind.Absolute,
                out var apiUri) ||
            (apiUri.Scheme != Uri.UriSchemeHttp &&
             apiUri.Scheme != Uri.UriSchemeHttps))
        {
            Add("Enter a valid HTTP or HTTPS API URL.");
            return false;
        }

        if (!paired || string.IsNullOrWhiteSpace(pairingToken.Text) ||
            string.IsNullOrWhiteSpace(organizationId.Text) ||
            string.IsNullOrWhiteSpace(examId.Text) ||
            string.IsNullOrWhiteSpace(candidateId.Text) ||
            string.IsNullOrWhiteSpace(attemptId.Text))
        {
            Add("Automatic pairing is required before scanning.");
            return false;
        }

        scanning = true;
        startButton.Enabled = false;
        stopButton.Enabled = true;

        sessionSalt =
            Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

        Add("Starting consented scan session.");

        bluetoothAvailable = false;
        wifiAvailable = false;
        try
        {
            bluetooth.Start();
            bluetoothAvailable = true;

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

        if (!bluetoothAvailable && !wifiAvailable)
        {
            scanning = false;
            startButton.Enabled = true;
            stopButton.Enabled = false;
            Add("No permitted Bluetooth or Wi-Fi scanner is available. Monitoring did not start.");
            await Submit("scanner_health", "scan_unavailable", null, "no_scanner_available", "unavailable");
            return false;
        }

        if (scanning)
        {
            Add("Initial scan completed. BLE observations continue while scanning is active.");
            await Submit("scanner_health", "heartbeat", null, null, "active");
            heartbeatTimer?.Dispose();
            heartbeatTimer = new System.Threading.Timer(async _ =>
            {
                if (!scanning || closing)
                    return;

                if (!pairingExpiresAt.HasValue ||
                    pairingExpiresAt.Value <= DateTimeOffset.UtcNow.AddSeconds(30))
                {
                    Add("Companion credential expired; stopping local monitoring.");
                    await InvokeOnUiAsync(() => StopAsync(reportToServer: false));
                    return;
                }

                await Submit("scanner_health", "heartbeat", null, null, "active");
            }, null, TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(30));
            return true;
        }
        return false;
    }

    private async Task<bool> PairAsync()
    {
        if (!Uri.TryCreate(apiUrl.Text.Trim(), UriKind.Absolute, out var apiUri) ||
            (apiUri.Scheme != Uri.UriSchemeHttp && apiUri.Scheme != Uri.UriSchemeHttps))
        {
            Add("Automatic connection supplied an invalid API URL.");
            return false;
        }
        if (string.IsNullOrWhiteSpace(pairingToken.Text))
        {
            Add("The browser did not provide a temporary Companion credential.");
            return false;
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
                Add($"Automatic pairing was not accepted ({(int)response.StatusCode}). Return to the active exam and retry.");
                return false;
            }
            var payload = await response.Content.ReadFromJsonAsync<PairingResponse>();
            if (payload?.Context is null ||
                string.IsNullOrWhiteSpace(payload.Context.OrganizationId) ||
                string.IsNullOrWhiteSpace(payload.Context.ExamId) ||
                string.IsNullOrWhiteSpace(payload.Context.CandidateId) ||
                string.IsNullOrWhiteSpace(payload.Context.AttemptId) ||
                !payload.ExpiresAt.HasValue ||
                payload.ExpiresAt.Value <= DateTimeOffset.UtcNow.AddSeconds(30))
            {
                paired = false;
                pairingExpiresAt = null;
                Add("Pairing response has missing, invalid, or expired credentials/context.");
                return false;
            }
            // A running scan belongs to exactly one attempt. Stop the previous
            // context before changing IDs or rotating its session pseudonym salt.
            if (scanning && !string.Equals(attemptId.Text, payload.Context.AttemptId, StringComparison.Ordinal))
                await StopAsync();

            organizationId.Text = payload.Context.OrganizationId;
            examId.Text = payload.Context.ExamId;
            candidateId.Text = payload.Context.CandidateId;
            attemptId.Text = payload.Context.AttemptId;
            pairingExpiresAt = payload.ExpiresAt;
            paired = true;
            Add("Automatic pairing verified for the active exam attempt.");
            return true;
        }
        catch (TaskCanceledException)
        {
            paired = false;
            Add("Automatic pairing timed out. Check that the API is running.");
            return false;
        }
        catch (HttpRequestException ex)
        {
            paired = false;
            Add($"Automatic pairing network/API error: {ex.Message}");
            return false;
        }
        finally
        {
            pairButton.Enabled = true;
        }
    }

    private async Task StartLocalBridgeAsync()
    {
        try
        {
            bridge.Prefixes.Add(BridgePrefix);
            bridge.Start();
            Add("Local browser bridge is ready on 127.0.0.1:43117.");
            bridgeTask = Task.Run(() => LocalBridgeLoopAsync(bridgeCancellation.Token));
        }
        catch (Exception ex)
        {
            Add($"Local browser bridge could not start: {ex.GetType().Name}. Run Register-ExamGuard-Companion.ps1 once as Administrator.");
        }
        await Task.CompletedTask;
    }

    private async Task LocalBridgeLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested && bridge.IsListening)
        {
            HttpListenerContext context;
            try
            {
                context = await bridge.GetContextAsync();
            }
            catch (HttpListenerException) { break; }
            catch (ObjectDisposedException) { break; }

            _ = Task.Run(() => HandleLocalBridgeRequestAsync(context), cancellationToken);
        }
    }

    private static bool IsTrustedLocalApiUri(Uri apiUri)
    {
        // This build is intentionally local-first. Never forward an attempt
        // credential to an arbitrary host supplied by a browser request.
        var configured = Environment.GetEnvironmentVariable("EXAMGUARD_API_URL");
        var allowed = new[] { "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4000", "http://127.0.0.1:4000", configured }
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => Uri.TryCreate(value, UriKind.Absolute, out var parsed) ? parsed : null)
            .Where(value => value is not null);
        return allowed.Any(value => string.Equals(value!.GetLeftPart(UriPartial.Authority), apiUri.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsTrustedBrowserOrigin(string? origin)
    {
        if (string.IsNullOrWhiteSpace(origin)) return false;
        var configured = Environment.GetEnvironmentVariable("EXAMGUARD_CLIENT_ORIGIN");
        var allowed = new[]
        {
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            configured
        }.Where(value => !string.IsNullOrWhiteSpace(value));
        return allowed.Contains(origin, StringComparer.OrdinalIgnoreCase);
    }

    private async Task HandleLocalBridgeRequestAsync(HttpListenerContext context)
    {
        try
        {
            var request = context.Request;
            var response = context.Response;
            var origin = request.Headers["Origin"];
            if (request.RemoteEndPoint is null || !IPAddress.IsLoopback(request.RemoteEndPoint.Address) || !IsTrustedBrowserOrigin(origin))
            {
                response.StatusCode = 403;
                await WriteBridgeJsonAsync(response, new { error = "Origin or client is not allowed." });
                return;
            }

            response.Headers["Access-Control-Allow-Origin"] = origin!;
            response.Headers["Vary"] = "Origin";
            response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
            response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
            response.Headers["Access-Control-Allow-Private-Network"] = "true";
            response.Headers["Cache-Control"] = "no-store";

            if (request.HttpMethod == "OPTIONS")
            {
                response.StatusCode = 204;
                response.Close();
                return;
            }

            if (request.HttpMethod == "GET" && request.Url?.AbsolutePath == "/health")
            {
                await WriteBridgeJsonAsync(response, new { status = "ready", paired, scanning });
                return;
            }

            if (request.HttpMethod == "POST" && request.Url?.AbsolutePath == "/stop")
            {
                await InvokeOnUiAsync(() => StopAsync());
                await WriteBridgeJsonAsync(response, new { status = "stopped", scanning = false });
                return;
            }

            if (request.HttpMethod != "POST" || request.Url?.AbsolutePath != "/pair")
            {
                response.StatusCode = 404;
                await WriteBridgeJsonAsync(response, new { error = "Local bridge route not found." });
                return;
            }

            if (request.ContentLength64 > 16 * 1024)
            {
                response.StatusCode = 413;
                await WriteBridgeJsonAsync(response, new { error = "Request is too large." });
                return;
            }

            using var reader = new System.IO.StreamReader(request.InputStream, request.ContentEncoding);
            var bodyBuilder = new StringBuilder();
            var readBuffer = new char[4096];
            int charsRead;
            while ((charsRead = await reader.ReadAsync(readBuffer, 0, readBuffer.Length)) > 0)
            {
                if (bodyBuilder.Length + charsRead > 16 * 1024)
                {
                    response.StatusCode = 413;
                    await WriteBridgeJsonAsync(response, new { error = "Request is too large." });
                    return;
                }
                bodyBuilder.Append(readBuffer, 0, charsRead);
            }
            using var json = JsonDocument.Parse(bodyBuilder.ToString());
            var root = json.RootElement;
            var requestedApiUrl = root.GetProperty("apiUrl").GetString();
            var token = root.GetProperty("pairingToken").GetString();
            var consentGranted = root.TryGetProperty("consentGranted", out var consentValue) && consentValue.ValueKind == JsonValueKind.True;
            if (!consentGranted || string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(requestedApiUrl) ||
                !Uri.TryCreate(requestedApiUrl, UriKind.Absolute, out var apiUri) ||
                apiUri.Scheme != Uri.UriSchemeHttp ||
                apiUri.AbsolutePath != "/" ||
                !string.IsNullOrEmpty(apiUri.Query) ||
                !string.IsNullOrEmpty(apiUri.Fragment) ||
                !string.IsNullOrEmpty(apiUri.UserInfo) ||
                !IsTrustedLocalApiUri(apiUri))
            {
                response.StatusCode = 400;
                await WriteBridgeJsonAsync(response, new { error = "A valid API URL, pairing credential and explicit monitoring consent are required." });
                return;
            }

            var connected = false;
            await InvokeOnUiAsync(async () =>
            {
                apiUrl.Text = apiUri.ToString().TrimEnd('/');
                pairingToken.Text = token;
                consent.Checked = true; // The student explicitly consented in the ExamGuard readiness screen.
                if (!await PairAsync())
                {
                    Add("Pairing renewal failed; stopping local monitoring.");
                    await StopAsync(reportToServer: false);
                    return;
                }
                connected = await StartAsync();
            });

            if (!connected)
            {
                response.StatusCode = 503;
                await WriteBridgeJsonAsync(response, new { error = "The Companion could not start monitoring. Check Bluetooth/Wi-Fi permissions and retry." });
                return;
            }

            await WriteBridgeJsonAsync(response, new { status = "connected", scanning = true });
        }
        catch (JsonException)
        {
            context.Response.StatusCode = 400;
            await WriteBridgeJsonAsync(context.Response, new { error = "Invalid local bridge request." });
        }
        catch (Exception ex)
        {
            context.Response.StatusCode = 500;
            await WriteBridgeJsonAsync(context.Response, new { error = $"Local bridge error: {ex.GetType().Name}" });
        }
    }

    private static async Task WriteBridgeJsonAsync(HttpListenerResponse response, object value)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value));
        response.ContentType = "application/json; charset=utf-8";
        response.ContentLength64 = bytes.Length;
        try { await response.OutputStream.WriteAsync(bytes); }
        finally { response.Close(); }
    }

    private Task InvokeOnUiAsync(Func<Task> action)
    {
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (IsDisposed || !IsHandleCreated)
        {
            completion.SetException(new ObjectDisposedException(nameof(MonitorForm)));
            return completion.Task;
        }
        BeginInvoke(new Action(async () =>
        {
            try { await action(); completion.SetResult(true); }
            catch (Exception ex) { completion.SetException(ex); }
        }));
        return completion.Task;
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
            // NativeWifi is a synchronous native helper. Run it away from the
            // UI thread so permission prompts and driver delays stay visible.
            var results = await Task.Run(NativeWifi.Scan);

            foreach (var diagnostic in NativeWifi.DrainDiagnostics())
                Add($"Wi-Fi diagnostic: {diagnostic}");

            wifiAvailable = true;
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
            wifiAvailable = false;
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

    private async Task StopAsync(bool reportToServer = true)
    {
        if (!scanning)
            return;

        scanning = false;
        heartbeatTimer?.Dispose();
        heartbeatTimer = null;
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

        if (reportToServer)
        {
            await Submit(
                "scanner_health",
                "scan_stopped",
                null,
                null,
                "stopped");
        }

        Add(reportToServer
            ? "Scanning stopped. Session ended."
            : "Local scanning stopped. No server report was sent.");

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
            if (rssi.HasValue && (rssi.Value < -127 || rssi.Value > 0))
            {
                Add($"Skipped invalid RSSI value: {rssi.Value}.");
                rssi = null;
            }

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
                Content = JsonContent.Create(payload, options: new System.Text.Json.JsonSerializerOptions { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull })
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

            if (response.StatusCode == HttpStatusCode.Unauthorized ||
                response.StatusCode == HttpStatusCode.Forbidden)
            {
                paired = false;
                Add("Server rejected Companion credentials; stopping local monitoring.");
                if (InvokeRequired)
                    await InvokeOnUiAsync(() => StopAsync(reportToServer: false));
                else
                    await StopAsync(reportToServer: false);
            }
            else if (!response.IsSuccessStatusCode)
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
            heartbeatTimer?.Dispose();
            bridgeCancellation.Cancel();
            if (bridge.IsListening) bridge.Stop();
            bridge.Close();
            if (bluetooth.Status == BluetoothLEAdvertisementWatcherStatus.Started)
                bluetooth.Stop();
            http.Dispose();
            bridgeCancellation.Dispose();
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


