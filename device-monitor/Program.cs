
using System;
using System.Drawing;
using System.Linq;
using Microsoft.Win32;
using System.IO;
using System.IO.Pipes;
using System.Net.Http;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
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
    private const string ActivationPipeName = "ExamGuard.DeviceMonitor.Activation";
    private const byte ActivateCommand = 1;
    private static Mutex? singleInstance;

    [STAThread]
    static void Main(string[] args)
    {
        singleInstance = new Mutex(true, "ExamGuard.DeviceMonitor.SingleInstance", out var ownsMutex);
        if (!ownsMutex)
        {
            if (args.Any(IsStartProtocolArgument) && !SignalExistingInstance())
            {
                MessageBox.Show(
                    "The running ExamGuard Companion could not be activated.",
                    "ExamGuard Companion",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
            return;
        }

        ApplicationConfiguration.Initialize();
        var form = new MonitorForm();
        _ = form.Handle;
        using var activationCancellation = new CancellationTokenSource();
        var activationTask = RunActivationServerAsync(form, activationCancellation.Token);
        try { Application.Run(form); }
        finally
        {
            activationCancellation.Cancel();
            try { activationTask.GetAwaiter().GetResult(); }
            finally { singleInstance.ReleaseMutex(); singleInstance.Dispose(); }
        }
    }

    private static bool IsStartProtocolArgument(string argument) =>
        Uri.TryCreate(argument, UriKind.Absolute, out var uri) &&
        string.Equals(uri.Scheme, "examguard-companion", StringComparison.OrdinalIgnoreCase) &&
        string.Equals(uri.Host, "start", StringComparison.OrdinalIgnoreCase);

    private static bool SignalExistingInstance()
    {
        const int timeoutMilliseconds = 5000;
        var elapsedMilliseconds = 0;
        while (elapsedMilliseconds < timeoutMilliseconds)
        {
            try
            {
                using var pipe = new NamedPipeClientStream(
                    ".",
                    ActivationPipeName,
                    PipeDirection.Out,
                    PipeOptions.Asynchronous);
                pipe.Connect(250);
                pipe.WriteByte(ActivateCommand);
                pipe.Flush();
                return true;
            }
            catch (Exception ex) when (ex is IOException or TimeoutException or UnauthorizedAccessException)
            {
                Thread.Sleep(100);
                elapsedMilliseconds += 350;
            }
        }

        return false;
    }

    private static async Task RunActivationServerAsync(
        MonitorForm form,
        CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                using var pipe = new NamedPipeServerStream(
                    ActivationPipeName,
                    PipeDirection.In,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(cancellationToken);

                using var readTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                readTimeout.CancelAfter(TimeSpan.FromSeconds(2));
                var command = new byte[1];
                try
                {
                    var bytesRead = await pipe.ReadAsync(command.AsMemory(), readTimeout.Token);
                    if (bytesRead == 1 && command[0] == ActivateCommand)
                        await form.ActivateFromProtocolAsync();
                }
                catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                {
                    // Ignore incomplete local IPC clients and continue accepting activation requests.
                }
                catch (IOException)
                {
                    // A client may disconnect before sending its command.
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (ObjectDisposedException) when (form.IsDisposed || cancellationToken.IsCancellationRequested)
        {
        }
        catch (InvalidOperationException) when (form.IsDisposed || cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            form.Add($"Single-instance activation channel failed: {ex.Message}");
        }
    }
}

internal sealed class MonitorForm : Form
{
    private readonly TextBox apiUrl = new()
    {
        Text = ConfiguredSetting("ApiUrl") ?? "http://localhost:4000"
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

    private readonly Label radioSyncStatus = new()
    {
        Text = "Backend sync: idle",
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
        Text = "Stop consented monitoring",
        AutoSize = true
    };

    private BluetoothLEAdvertisementWatcher bluetooth = null!;
    private Windows.Foundation.TypedEventHandler<BluetoothLEAdvertisementWatcher, BluetoothLEAdvertisementReceivedEventArgs>? bluetoothReceivedHandler;
    private Windows.Foundation.TypedEventHandler<BluetoothLEAdvertisementWatcher, BluetoothLEAdvertisementWatcherStoppedEventArgs>? bluetoothStoppedHandler;
    private readonly object bluetoothStopSync = new();
    private readonly SemaphoreSlim bluetoothLifecycleGate = new(1, 1);
    private TaskCompletionSource<bool>? bluetoothStoppedCompletion;
    private volatile bool bluetoothStopExpected;
    private readonly HttpClient http = new()
    {
        Timeout = TimeSpan.FromSeconds(10)
    };

    private string sessionSalt =
        Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

    private volatile bool scanning;
    private volatile bool closing;
    private bool wifiScanRunning;
    private bool pairingInProgress;
    private bool bluetoothAvailable;
    private bool wifiAvailable;
    private bool paired;
    private DateTimeOffset? pairingExpiresAt;
    private readonly BridgeAuthorizationSessions bridgeAuthorizationSessions = new();
    private readonly RadioObservationOutbox radioOutbox = new();
    private readonly RadioObservationSampler radioSampler = new();

    private readonly TcpListener bridge = new(IPAddress.Loopback, 43117);
    private readonly NotifyIcon trayIcon;
    private readonly CancellationTokenSource bridgeCancellation = new();
    private Task? bridgeTask;
    private bool bridgeStartAttempted;
    private System.Threading.Timer? heartbeatTimer;
    private System.Threading.Timer? wifiScanTimer;
    private System.Threading.Timer? radioUploadTimer;
    private long reportedDroppedObservationCount;

    public MonitorForm()
    {
        bluetooth = CreateBluetoothWatcher();
        Text = "ExamGuard Device Monitor";
        Width = 800;
        Height = 620;
        MinimumSize = new Size(600, 500);
        StartPosition = FormStartPosition.CenterScreen;
        trayIcon = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "ExamGuard Companion",
            Visible = true,
            ContextMenuStrip = new ContextMenuStrip()
        };
        trayIcon.ContextMenuStrip.Items.Add("Show monitor", null, (_, _) => RestoreFromTray());
        trayIcon.ContextMenuStrip.Items.Add("Exit", null, async (_, _) => await CloseFromTrayAsync());
        trayIcon.DoubleClick += (_, _) => RestoreFromTray();

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
            Text = "How to use ExamGuard Companion:\r\n1. Keep this app running while you use ExamGuard.\r\n2. Sign in to ExamGuard and open your assigned exam.\r\n3. In readiness, test your devices, choose Entire screen / Monitor in the browser picker, and read the monitoring notice.\r\n4. Accept consent only if you agree, then start the exam. ExamGuard connects this app using a short-lived authenticated token; never copy or share a token.\r\n5. Keep this window open until you submit. Bluetooth and Wi-Fi show the local scanner status. Stop consented monitoring ends scans.\r\nThis Companion reports radio observations only and scans the attempt paired by the active ExamGuard tab. ExamGuard uses a browser-managed lock to keep one ExamGuard exam tab active where supported; this Companion does not control tabs. Browser screen sharing and periodic still images are handled by ExamGuard and require separate browser permission. Neither app can close unrelated tabs or prevent switching to other Windows applications; use a managed kiosk browser/device when enforced lockdown is required.",
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
        buttons.Controls.Add(radioSyncStatus);

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

        consent.CheckedChanged += (_, _) =>
        {
            if (!consent.Checked && scanning)
            {
                Add("Consent withdrawn; stopping scan.");
                _ = StopAsync();
            }
        };

        FormClosing += (_, e) =>
        {
            if (e.CloseReason == CloseReason.UserClosing && !closing)
            {
                e.Cancel = true;
                HideToTray();
            }
        };
        Resize += (_, _) => { if (WindowState == FormWindowState.Minimized) HideToTray(); };
        radioUploadTimer = new System.Threading.Timer(
            async _ => await PumpRadioOutboxAsync(),
            null,
            TimeSpan.FromSeconds(1),
            TimeSpan.FromSeconds(1));
    }

    private BluetoothLEAdvertisementWatcher CreateBluetoothWatcher()
    {
        var watcher = new BluetoothLEAdvertisementWatcher
        {
            ScanningMode = BluetoothLEScanningMode.Active,
            AllowExtendedAdvertisements = true
        };
        bluetoothReceivedHandler = (_, e) =>
        {
            if (ReferenceEquals(watcher, bluetooth))
                BluetoothReceived(e);
        };
        bluetoothStoppedHandler = (_, e) =>
        {
            if (ReferenceEquals(watcher, bluetooth))
                HandleBluetoothStopped(e.Error);
        };
        watcher.Received += bluetoothReceivedHandler;
        watcher.Stopped += bluetoothStoppedHandler;
        return watcher;
    }

    private void ReplaceBluetoothWatcher()
    {
        if (bluetoothReceivedHandler is not null)
            bluetooth.Received -= bluetoothReceivedHandler;
        if (bluetoothStoppedHandler is not null)
            bluetooth.Stopped -= bluetoothStoppedHandler;
        bluetooth = CreateBluetoothWatcher();
    }

    private static async Task<BluetoothRadioDiagnostic> ReadBluetoothRadioDiagnosticAsync()
    {
        try
        {
            var adapter = await BluetoothAdapter.GetDefaultAsync();
            if (adapter is null)
                return new BluetoothRadioDiagnostic(false, false, false, null, null);

            var radio = await adapter.GetRadioAsync();
            return new BluetoothRadioDiagnostic(
                true,
                adapter.IsLowEnergySupported,
                adapter.IsCentralRoleSupported,
                radio?.State.ToString(),
                radio is null ? "Bluetooth radio state is unavailable." : null);
        }
        catch (Exception ex)
        {
            return new BluetoothRadioDiagnostic(
                null,
                null,
                null,
                null,
                $"{ex.GetType().Name}; HRESULT=0x{ex.HResult:X8}");
        }
    }

    private async Task<bool> StartBluetoothWatcherAsync()
    {
        await bluetoothLifecycleGate.WaitAsync();
        try
        {
            for (var attempt = 0; attempt < 4; attempt++)
            {
                if (!scanning || !consent.Checked || !paired ||
                    !pairingExpiresAt.HasValue ||
                    pairingExpiresAt.Value <= DateTimeOffset.UtcNow.AddSeconds(30))
                    return false;

                switch (BluetoothWatcherLifecycle.PlanStart(MapBluetoothWatcherState(bluetooth.Status)))
                {
                    case BluetoothWatcherStartAction.Start:
                        bluetooth.Start();
                        if (bluetooth.Status != BluetoothLEAdvertisementWatcherStatus.Started)
                            throw new InvalidOperationException($"Bluetooth watcher did not start; state={bluetooth.Status}.");
                        return true;
                    case BluetoothWatcherStartAction.StopAndWait:
                    case BluetoothWatcherStartAction.WaitForStop:
                        await StopBluetoothWatcherAndWaitAsync();
                        break;
                    case BluetoothWatcherStartAction.Recreate:
                        ReplaceBluetoothWatcher();
                        break;
                    default:
                        throw new InvalidOperationException($"Bluetooth watcher cannot start from state {bluetooth.Status}.");
                }
            }

            throw new TimeoutException($"Bluetooth watcher did not reach a startable state; state={bluetooth.Status}.");
        }
        finally
        {
            bluetoothLifecycleGate.Release();
        }
    }

    private async Task StopBluetoothWatcherSerializedAsync()
    {
        await bluetoothLifecycleGate.WaitAsync();
        try
        {
            await StopBluetoothWatcherAndWaitAsync();
        }
        finally
        {
            bluetoothLifecycleGate.Release();
        }
    }

    private async Task StopBluetoothWatcherAndWaitAsync()
    {
        var watcher = bluetooth;
        bluetoothStopExpected = true;
        TaskCompletionSource<bool>? completion = null;
        try
        {
            var state = watcher.Status;
            if (state is BluetoothLEAdvertisementWatcherStatus.Created
                or BluetoothLEAdvertisementWatcherStatus.Stopped
                or BluetoothLEAdvertisementWatcherStatus.Aborted)
                return;

            completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            lock (bluetoothStopSync)
                bluetoothStoppedCompletion = completion;

            state = watcher.Status;
            if (state == BluetoothLEAdvertisementWatcherStatus.Started)
                watcher.Stop();
            else if (state != BluetoothLEAdvertisementWatcherStatus.Stopping &&
                     state != BluetoothLEAdvertisementWatcherStatus.Stopped &&
                     state != BluetoothLEAdvertisementWatcherStatus.Aborted)
                throw new InvalidOperationException($"Bluetooth watcher entered unexpected state {state} while stopping.");

            if (watcher.Status is BluetoothLEAdvertisementWatcherStatus.Stopped
                or BluetoothLEAdvertisementWatcherStatus.Aborted)
                return;

            var completed = await Task.WhenAny(completion.Task, Task.Delay(TimeSpan.FromSeconds(5)));
            if (completed != completion.Task)
                throw new TimeoutException($"Bluetooth watcher stop timed out; state={watcher.Status}.");

            if (watcher.Status is not (BluetoothLEAdvertisementWatcherStatus.Stopped
                or BluetoothLEAdvertisementWatcherStatus.Aborted))
                throw new InvalidOperationException($"Bluetooth watcher stop completed in state {watcher.Status}.");
        }
        finally
        {
            lock (bluetoothStopSync)
            {
                if (completion is not null && ReferenceEquals(bluetoothStoppedCompletion, completion))
                    bluetoothStoppedCompletion = null;
            }
            bluetoothStopExpected = false;
        }
    }

    private static BluetoothWatcherState MapBluetoothWatcherState(
        BluetoothLEAdvertisementWatcherStatus status) => status switch
    {
        BluetoothLEAdvertisementWatcherStatus.Created => BluetoothWatcherState.Created,
        BluetoothLEAdvertisementWatcherStatus.Started => BluetoothWatcherState.Started,
        BluetoothLEAdvertisementWatcherStatus.Stopping => BluetoothWatcherState.Stopping,
        BluetoothLEAdvertisementWatcherStatus.Stopped => BluetoothWatcherState.Stopped,
        BluetoothLEAdvertisementWatcherStatus.Aborted => BluetoothWatcherState.Aborted,
        _ => BluetoothWatcherState.Unknown
    };

    private static string DescribeException(Exception exception) =>
        $"{exception.GetType().FullName}: {exception.Message}; HRESULT=0x{exception.HResult:X8}; stack={exception.StackTrace ?? "(unavailable)"}";

    private sealed record BluetoothRadioDiagnostic(
        bool? AdapterFound,
        bool? LowEnergyAvailable,
        bool? SupportsLeCentral,
        string? State,
        string? Error)
    {
        public string Summary =>
            $"adapterFound={AdapterFound?.ToString() ?? "unknown"}; " +
            $"lowEnergy={LowEnergyAvailable?.ToString() ?? "unknown"}; " +
            $"leCentral={SupportsLeCentral?.ToString() ?? "unknown"}; " +
            $"state={State ?? "unknown"}" +
            (Error is null ? string.Empty : $"; diagnosticError={Error}");
    }

    private void HideToTray()
    {
        Hide();
        trayIcon.ShowBalloonTip(1500, "ExamGuard Companion", scanning ? "Monitoring is active." : "Companion is ready for an authorized exam.", ToolTipIcon.Info);
    }

    private void RestoreFromTray()
    {
        Show();
        WindowState = FormWindowState.Normal;
        BringToFront();
        Activate();
    }

    internal Task ActivateFromProtocolAsync() =>
        InvokeOnUiAsync(() =>
        {
            RestoreFromTray();
            return Task.CompletedTask;
        });

    private async Task CloseFromTrayAsync()
    {
        if (scanning) await StopAsync();
        for (var attempt = 0; attempt < 4 && radioOutbox.PendingCount > 0; attempt++)
        {
            await PumpRadioOutboxAsync();
            if (radioOutbox.PendingCount > 0)
                await Task.Delay(TimeSpan.FromSeconds(attempt + 1));
        }
        if (radioOutbox.PendingCount > 0)
        {
            var pending = radioOutbox.PendingCount;
            var choice = MessageBox.Show(
                this,
                $"{pending} radio observations are still queued and cannot be saved after closing. Cancel to leave the Companion running and retry synchronization, or choose OK to close and discard them.",
                "Radio observations are not synchronized",
                MessageBoxButtons.OKCancel,
                MessageBoxIcon.Warning);
            if (choice != DialogResult.OK)
                return;
            Add($"Closing with {pending} unsynchronized radio observations; they will be discarded.");
        }
        closing = true;
        Close();
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
        var bluetoothRadio = await ReadBluetoothRadioDiagnosticAsync();
        Add($"Bluetooth radio diagnostic: {bluetoothRadio.Summary}");
        try
        {
            if (!await StartBluetoothWatcherAsync())
            {
                if (scanning)
                    await StopAsync(reportToServer: false);
                return false;
            }

            bluetoothAvailable = true;
            SetBluetoothStatus("Bluetooth: active");
            Add($"Bluetooth LE watcher started; state={bluetooth.Status}.");
            await Submit("bluetooth_le", "scanner_status", null, null, "active");
        }
        catch (Exception ex)
        {
            bluetoothAvailable = false;
            var status = BluetoothWatcherLifecycle.ClassifyStartFailure(
                ex,
                bluetoothRadio.AdapterFound,
                bluetoothRadio.LowEnergyAvailable,
                bluetoothRadio.SupportsLeCentral,
                bluetoothRadio.State);
            SetBluetoothStatus(status == "permission_denied"
                ? "Bluetooth: permission required"
                : status == "unavailable" ? "Bluetooth: unavailable" : "Bluetooth: scanner error");
            Add($"Bluetooth watcher start failed: {DescribeException(ex)}; watcherState={bluetooth.Status}; radio={bluetoothRadio.Summary}");
            await Submit("bluetooth_le", "scanner_status", null, ex.HResult.ToString("X8"), status);
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

                if (!bluetoothAvailable && !wifiAvailable)
                {
                    await Submit("scanner_health", "scan_unavailable", null, "no_active_scanner", "unavailable");
                    await InvokeOnUiAsync(() => StopAsync(reportToServer: false));
                    return;
                }

                if (!pairingExpiresAt.HasValue ||
                    pairingExpiresAt.Value <= DateTimeOffset.UtcNow.AddSeconds(30))
                {
                    Add("Companion credential expired; stopping local monitoring.");
                    await InvokeOnUiAsync(() => StopAsync(reportToServer: false));
                    return;
                }

                if (bluetoothAvailable)
                    await Submit("bluetooth_le", "scanner_status", null, null, "active");
                if (wifiAvailable)
                    await Submit("wifi", "scanner_status", null, null, "active");
                await Submit("scanner_health", "heartbeat", null, null, "active");
            }, null, TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(30));
            wifiScanTimer?.Dispose();
            wifiScanTimer = new System.Threading.Timer(async _ =>
            {
                if (scanning && !closing)
                    await ScanWifiAsync();
            }, null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(1));
            radioUploadTimer?.Change(TimeSpan.Zero, TimeSpan.FromSeconds(1));
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
        pairingInProgress = true;
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
                var body = await response.Content.ReadAsStringAsync();
                var summary = CompanionApiErrorSummary.FromBody(
                    body,
                    response.Content.Headers.ContentType?.MediaType,
                    pairingToken.Text.Trim());
                Add($"Automatic pairing was not accepted ({(int)response.StatusCode}): {summary}. Return to the active exam and retry.");
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
            var attemptChanged = !string.IsNullOrEmpty(attemptId.Text) &&
                !string.Equals(attemptId.Text, payload.Context.AttemptId, StringComparison.Ordinal);
            if (attemptChanged && radioOutbox.PendingCount > 0)
            {
                for (var flushAttempt = 0; flushAttempt < 4 && radioOutbox.PendingCount > 0; flushAttempt++)
                {
                    await PumpRadioOutboxAsync(allowDuringPairing: true);
                    if (radioOutbox.PendingCount > 0)
                        await Task.Delay(TimeSpan.FromSeconds(flushAttempt + 1));
                }
                if (radioOutbox.PendingCount > 0)
                {
                    if (scanning) await StopAsync(reportToServer: false);
                    Add("Previous-attempt observations are still syncing. The new attempt was not paired; retry after synchronization.");
                    return false;
                }
            }
            // A running scan belongs to exactly one attempt. Stop the previous
            // context before changing IDs or rotating its session pseudonym salt.
            if (scanning && attemptChanged)
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
            var statusCode = ex.StatusCode.HasValue ? ((int)ex.StatusCode.Value).ToString() : "none";
            var detail = ex.Message.Replace(pairingToken.Text.Trim(), "[redacted]", StringComparison.Ordinal);
            var innerType = ex.InnerException?.GetType().Name ?? "none";
            Add($"Automatic pairing network/API error: status={statusCode}; {ex.GetType().Name}; inner={innerType}; detail={detail}.");
            return false;
        }
        finally
        {
            pairingInProgress = false;
            pairButton.Enabled = true;
        }
    }

    private Task StartLocalBridgeAsync()
    {
        if (bridgeStartAttempted)
            return Task.CompletedTask;

        bridgeStartAttempted = true;
        try
        {
            bridge.Server.ExclusiveAddressUse = true;
            bridge.Start();
            Add("Local browser bridge is ready on 127.0.0.1:43117.");
            bridgeTask = Task.Run(() => LocalBridgeLoopAsync(bridgeCancellation.Token));
        }
        catch (SocketException ex)
        {
            Add($"Local browser bridge could not start on 127.0.0.1:43117: {ex.SocketErrorCode} ({ex.Message}).");
        }
        return Task.CompletedTask;
    }

    private async Task LocalBridgeLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await bridge.AcceptTcpClientAsync(cancellationToken);
            }
            catch (OperationCanceledException) { break; }
            catch (SocketException ex)
            {
                if (cancellationToken.IsCancellationRequested)
                    break;
                Add($"Local browser bridge accept failed: {ex.SocketErrorCode} ({ex.Message}).");
                try
                {
                    await Task.Delay(250, cancellationToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                continue;
            }
            catch (ObjectDisposedException) { break; }

            _ = Task.Run(() => HandleLocalBridgeRequestAsync(client));
        }
    }

    private static bool IsTrustedLocalApiUri(Uri apiUri)
    {
        var configured = ConfiguredSetting("ApiUrl");
        var allowed = new[] { "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4000", "http://127.0.0.1:4000", configured }
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => Uri.TryCreate(value, UriKind.Absolute, out var parsed) ? parsed : null)
            .Where(value => value is not null);
        return allowed.Any(value => string.Equals(value!.GetLeftPart(UriPartial.Authority), apiUri.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsTrustedBrowserOrigin(string? origin)
    {
        if (string.IsNullOrWhiteSpace(origin)) return false;
        var configured = ConfiguredSetting("ClientOrigin");
        var allowed = new[]
        {
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            configured
        }.Where(value => !string.IsNullOrWhiteSpace(value));
        return allowed.Contains(origin, StringComparer.OrdinalIgnoreCase);
    }

    private static string? ConfiguredSetting(string name)
    {
        var environmentName = name == "ApiUrl" ? "EXAMGUARD_API_URL" : "EXAMGUARD_CLIENT_ORIGIN";
        var environmentValue = Environment.GetEnvironmentVariable(environmentName);
        if (!string.IsNullOrWhiteSpace(environmentValue)) return environmentValue.Trim().TrimEnd('/');
        using var settings = Registry.CurrentUser.OpenSubKey(@"Software\ExamGuard\Companion");
        var storedValue = settings?.GetValue(name) as string;
        return string.IsNullOrWhiteSpace(storedValue) ? null : storedValue.Trim().TrimEnd('/');
    }

    private async Task HandleLocalBridgeRequestAsync(TcpClient client)
    {
        using (client)
        try
        {
            var stream = client.GetStream();
            var request = await ReadBridgeRequestAsync(stream);
            if (request is null)
                return;
            var origin = request.Origin;
            if (client.Client.RemoteEndPoint is not IPEndPoint remoteEndPoint ||
                !IPAddress.IsLoopback(remoteEndPoint.Address) ||
                !IsTrustedBrowserOrigin(origin))
            {
                await WriteBridgeJsonAsync(stream, null, new { error = "Origin or client is not allowed." }, 403);
                return;
            }

            if (request.Method == "OPTIONS")
            {
                await WriteBridgeResponseAsync(stream, origin, 204, []);
                return;
            }

            if (request.Method == "GET" && request.Path == "/health")
            {
                if (!bridgeAuthorizationSessions.Authorize(request.Authorization, allowRegistration: true, now: DateTimeOffset.UtcNow))
                {
                    await WriteBridgeJsonAsync(stream, origin, new { error = "Local browser session is not authorized." }, 401);
                    return;
                }
                await WriteBridgeJsonAsync(stream, origin, new { status = "ready", paired, scanning });
                return;
            }

            if (request.Method == "POST" && request.Path == "/stop")
            {
                if (!bridgeAuthorizationSessions.Authorize(request.Authorization, allowRegistration: false, now: DateTimeOffset.UtcNow))
                {
                    await WriteBridgeJsonAsync(stream, origin, new { error = "Local browser session is not authorized." }, 401);
                    return;
                }
                await InvokeOnUiAsync(() => StopAsync());
                await WriteBridgeJsonAsync(stream, origin, new { status = "stopped", scanning = false });
                return;
            }

            if (request.Method != "POST" || request.Path != "/pair")
            {
                await WriteBridgeJsonAsync(stream, origin, new { error = "Local bridge route not found." }, 404);
                return;
            }
            if (!bridgeAuthorizationSessions.Authorize(request.Authorization, allowRegistration: false, now: DateTimeOffset.UtcNow))
            {
                await WriteBridgeJsonAsync(stream, origin, new { error = "Local browser session is not authorized." }, 401);
                return;
            }

            using var json = JsonDocument.Parse(request.Body);
            var root = json.RootElement;
            var requestedApiUrl = root.GetProperty("apiUrl").GetString();
            var token = root.GetProperty("pairingToken").GetString();
            var consentGranted = root.TryGetProperty("consentGranted", out var consentValue) && consentValue.ValueKind == JsonValueKind.True;
            if (!consentGranted || string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(requestedApiUrl) ||
                !Uri.TryCreate(requestedApiUrl, UriKind.Absolute, out var apiUri) ||
                (apiUri.Scheme != Uri.UriSchemeHttp && apiUri.Scheme != Uri.UriSchemeHttps) ||
                apiUri.AbsolutePath != "/" ||
                !string.IsNullOrEmpty(apiUri.Query) ||
                !string.IsNullOrEmpty(apiUri.Fragment) ||
                !string.IsNullOrEmpty(apiUri.UserInfo) ||
                !IsTrustedLocalApiUri(apiUri))
            {
                await WriteBridgeJsonAsync(stream, origin, new { error = "A valid API URL, pairing credential and explicit monitoring consent are required." }, 400);
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
                await WriteBridgeJsonAsync(stream, origin, new { error = "The Companion could not start monitoring. Check Bluetooth/Wi-Fi permissions and retry." }, 503);
                return;
            }

            await WriteBridgeJsonAsync(stream, origin, new { status = "connected", scanning = true });
        }
        catch (JsonException)
        {
            await WriteBridgeJsonAsync(client.GetStream(), null, new { error = "Invalid local bridge request." }, 400);
        }
        catch (InvalidDataException ex)
        {
            await WriteBridgeJsonAsync(client.GetStream(), null, new { error = ex.Message }, 413);
        }
        catch (Exception ex)
        {
            try { await WriteBridgeJsonAsync(client.GetStream(), null, new { error = $"Local bridge error: {ex.GetType().Name}" }, 500); }
            catch (IOException) { }
        }
    }

    private sealed record BridgeRequest(string Method, string Path, string? Origin, string? Authorization, byte[] Body);

    private static async Task<BridgeRequest?> ReadBridgeRequestAsync(NetworkStream stream)
    {
        const int maxHeaderBytes = 16 * 1024;
        var headerBytes = new List<byte>();
        var oneByte = new byte[1];
        while (headerBytes.Count < maxHeaderBytes)
        {
            var count = await stream.ReadAsync(oneByte);
            if (count == 0) return null;
            headerBytes.Add(oneByte[0]);
            var size = headerBytes.Count;
            if (size >= 4 &&
                headerBytes[size - 4] == 13 && headerBytes[size - 3] == 10 &&
                headerBytes[size - 2] == 13 && headerBytes[size - 1] == 10)
                break;
        }
        if (headerBytes.Count >= maxHeaderBytes) throw new InvalidDataException("Request headers are too large.");

        var headerText = Encoding.ASCII.GetString(headerBytes.ToArray());
        var lines = headerText.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        var requestLine = lines[0].Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (requestLine.Length != 3 || !requestLine[2].StartsWith("HTTP/1.", StringComparison.Ordinal))
            throw new JsonException("Invalid HTTP request line.");

        var target = requestLine[1];
        if (!Uri.TryCreate($"http://127.0.0.1{target}", UriKind.Absolute, out var targetUri))
            throw new JsonException("Invalid request path.");

        string? origin = null;
        string? authorization = null;
        var contentLength = 0;
        var hasTransferEncoding = false;
        foreach (var line in lines.Skip(1))
        {
            var separator = line.IndexOf(':');
            if (separator <= 0) continue;
            var name = line[..separator].Trim();
            var value = line[(separator + 1)..].Trim();
            if (name.Equals("Origin", StringComparison.OrdinalIgnoreCase)) origin = value;
            if (name.Equals("Authorization", StringComparison.OrdinalIgnoreCase)) authorization = value;
            if (name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) &&
                (!int.TryParse(value, out contentLength) || contentLength < 0))
                throw new JsonException("Invalid content length.");
            if (name.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase)) hasTransferEncoding = true;
        }
        if (hasTransferEncoding) throw new JsonException("Chunked requests are not supported.");
        if (contentLength > 16 * 1024) throw new InvalidDataException("Request is too large.");

        var body = new byte[contentLength];
        var offset = 0;
        while (offset < body.Length)
        {
            var count = await stream.ReadAsync(body.AsMemory(offset));
            if (count == 0) throw new JsonException("Incomplete request body.");
            offset += count;
        }
        return new BridgeRequest(requestLine[0].ToUpperInvariant(), targetUri.AbsolutePath, origin, authorization, body);
    }

    private static async Task WriteBridgeJsonAsync(NetworkStream stream, string? origin, object value, int statusCode = 200)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value));
        await WriteBridgeResponseAsync(stream, origin, statusCode, bytes, "application/json; charset=utf-8");
    }

    private static async Task WriteBridgeResponseAsync(NetworkStream stream, string? origin, int statusCode, byte[] body, string contentType = "application/json; charset=utf-8")
    {
        var reason = statusCode switch
        {
            200 => "OK",
            204 => "No Content",
            400 => "Bad Request",
            401 => "Unauthorized",
            403 => "Forbidden",
            404 => "Not Found",
            413 => "Payload Too Large",
            503 => "Service Unavailable",
            _ => "Internal Server Error",
        };
        var headers = new StringBuilder()
            .Append($"HTTP/1.1 {statusCode} {reason}\r\n")
            .Append($"Content-Type: {contentType}\r\n")
            .Append($"Content-Length: {body.Length}\r\n")
            .Append("Connection: close\r\n")
            .Append("Cache-Control: no-store\r\n")
            .Append("X-Content-Type-Options: nosniff\r\n");
        if (!string.IsNullOrEmpty(origin))
        {
            headers.Append($"Access-Control-Allow-Origin: {origin}\r\n")
                .Append("Vary: Origin\r\n")
                .Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
                .Append("Access-Control-Allow-Headers: Authorization, Content-Type\r\n")
                .Append("Access-Control-Allow-Private-Network: true\r\n");
        }
        headers.Append("\r\n");
        await stream.WriteAsync(Encoding.ASCII.GetBytes(headers.ToString()));
        if (body.Length > 0) await stream.WriteAsync(body);
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

    private void BluetoothReceived(BluetoothLEAdvertisementReceivedEventArgs e)
    {
        if (!scanning)
            return;

        if (e.BluetoothAddress == 0)
        {
            Add("BLE advertisement omitted because Windows did not provide a usable pseudonym source.");
            return;
        }

        var observedAt = DateTimeOffset.UtcNow;
        var pseudonym = RadioPrivacy.Pseudonym(sessionSalt, e.BluetoothAddress.ToString("X"));
        if (!radioSampler.ShouldAccept("bluetooth_le", pseudonym, observedAt))
            return;
        var advertisedName = SanitizeAdvertisedName(e.Advertisement.LocalName);

        Add(
            $"BLE advertisement observed (RSSI {e.RawSignalStrengthInDBm} dBm). " +
            "Device identity and device type are unknown.");

        _ = Submit(
            "bluetooth_le",
            "advertisement",
            e.RawSignalStrengthInDBm,
            null,
            "active",
            pseudonym,
            advertisedName,
            observedAt);
    }

    private async Task ScanWifiAsync()
    {
        if (!scanning || wifiScanRunning)
            return;

        wifiScanRunning = true;

        try
        {
            // NativeWifi waits for Windows scan-complete notifications away from the UI thread.
            var results = await Task.Run(NativeWifi.Scan);
            if (!scanning || closing)
            {
                Add("Wi-Fi scan completed after monitoring stopped; its observations were discarded.");
                return;
            }

            foreach (var diagnostic in NativeWifi.DrainDiagnostics())
                Add($"Wi-Fi diagnostic: {diagnostic}");

            foreach (var failure in results.Failures)
                Add($"Wi-Fi scan diagnostic: {failure.Category} ({failure.Code}).");

            var scanStatus = NativeWifi.ClassifyStatus(results);
            wifiAvailable = results.SuccessfulInterfaces > 0;
            Add($"Wi-Fi scan finished: status={scanStatus}; interfaces={results.SuccessfulInterfaces}/{results.TotalInterfaces}; distinctAccessPoints={results.AccessPoints.Count}.");
            if (!wifiAvailable)
            {
                SetWifiStatus(scanStatus == "permission_denied"
                    ? "Wi-Fi: permission required"
                    : scanStatus == "unavailable" ? "Wi-Fi: unavailable" : "Wi-Fi: scanner error");
                await Submit("wifi", "scanner_status", null, "wifi_scan_failed", scanStatus, observedAt: results.CompletedAt);
                return;
            }

            SetWifiStatus(results.Failures.Count == 0
                ? $"Wi-Fi: scan completed ({results.AccessPoints.Count} access points)"
                : $"Wi-Fi: partial scan ({results.SuccessfulInterfaces}/{results.TotalInterfaces} interfaces)");
            await Submit(
                "wifi",
                "scanner_status",
                null,
                results.Failures.Count == 0 ? null : $"partial_scan_failures:{results.Failures.Count}",
                scanStatus,
                observedAt: results.CompletedAt);
            await Submit("wifi", "scan_complete", null, null, "active", observedAt: results.CompletedAt);
            if (results.AccessPoints.Count == 0)
                Add("No Wi-Fi access points were visible in this scan.");

            foreach (var ap in results.AccessPoints)
            {
                if (!scanning)
                    break;

                Add(
                    $"Wi-Fi access point observed (RSSI {ap.Rssi} dBm). " +
                    "This is an environmental access point, not a nearby client device.");

                _ = Submit(
                    "wifi",
                    "access_point",
                    ap.Rssi,
                    null,
                    "active",
                    RadioPrivacy.Pseudonym(sessionSalt, ap.Bssid),
                    observedAt: results.CompletedAt);
            }
        }
        catch (Exception ex)
        {
            foreach (var diagnostic in NativeWifi.DrainDiagnostics())
                Add($"Wi-Fi diagnostic: {diagnostic}");

            wifiAvailable = false;
            var status = ex is WlanApiException wlan ? wlan.Category
                : ex is UnauthorizedAccessException ? "permission_denied"
                : "error";
            SetWifiStatus(status == "permission_denied"
                ? "Wi-Fi: permission required"
                : status == "unavailable" ? "Wi-Fi: unavailable" : "Wi-Fi: scanner error");
            Add($"Wi-Fi scan failed: {ex.GetType().Name}");

            await Submit("wifi", "scanner_status", null, ex is WlanApiException wlanApi ? wlanApi.ErrorCode : ex.HResult.ToString("X8"), status);
            await Submit("scanner_health", "scan_error", null, "wifi_api_error", "error");
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

        var bluetoothWasAvailable = bluetoothAvailable;
        var wifiWasAvailable = wifiAvailable;
        scanning = false;
        bluetoothAvailable = false;
        wifiAvailable = false;
        heartbeatTimer?.Dispose();
        heartbeatTimer = null;
        wifiScanTimer?.Dispose();
        wifiScanTimer = null;
        startButton.Enabled = true;
        stopButton.Enabled = false;

        try
        {
            await StopBluetoothWatcherSerializedAsync();
        }
        catch (Exception ex)
        {
            Add($"Error stopping Bluetooth watcher: {DescribeException(ex)}; watcherState={bluetooth.Status}.");
        }

        SetBluetoothStatus("Bluetooth: stopped");
        SetWifiStatus("Wi-Fi: stopped");

        if (reportToServer)
        {
            if (bluetoothWasAvailable)
                await Submit("bluetooth_le", "scanner_status", null, null, "stopped");
            if (wifiWasAvailable)
                await Submit("wifi", "scanner_status", null, null, "stopped");
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

    private void HandleBluetoothStopped(BluetoothError error)
    {
        lock (bluetoothStopSync)
            bluetoothStoppedCompletion?.TrySetResult(true);

        if (bluetoothStopExpected || !scanning)
            return;

        bluetoothAvailable = false;
        var status = error == BluetoothError.Success
            ? "stopped"
            : error == BluetoothError.ConsentRequired
                ? "permission_denied"
                : error == BluetoothError.RadioNotAvailable
                    ? "unavailable"
                    : "error";
        SetBluetoothStatus(status == "permission_denied"
            ? "Bluetooth: permission required"
            : status == "unavailable" ? "Bluetooth: unavailable" : status == "stopped" ? "Bluetooth: stopped" : "Bluetooth: scanner error");
        Add($"Bluetooth watcher stopped: {error}.");
        _ = Submit("bluetooth_le", "scanner_status", null, error.ToString(), status);
    }

    private static string? SanitizeAdvertisedName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        var characters = new char[Math.Min(value.Length, 80)];
        var count = 0;
        foreach (var character in value)
        {
            if (char.IsControl(character))
                continue;
            if (count == characters.Length)
                break;
            characters[count++] = character;
        }

        var sanitized = new string(characters, 0, count).Trim();
        return sanitized.Length == 0 ? null : sanitized;
    }

    private Task Submit(
        string source,
        string kind,
        int? rssi,
        string? errorCode,
        string status,
        string? pseudonym = null,
        string? advertisedName = null,
        DateTimeOffset? observedAt = null)
    {
        if (closing || IsDisposed)
            return Task.CompletedTask;

        if (InvokeRequired)
            return InvokeOnUiAsync(() => QueueObservation(
                source, kind, rssi, errorCode, status, pseudonym, advertisedName, observedAt));

        return QueueObservation(source, kind, rssi, errorCode, status, pseudonym, advertisedName, observedAt);
    }

    private Task QueueObservation(
        string source,
        string kind,
        int? rssi,
        string? errorCode,
        string status,
        string? pseudonym,
        string? advertisedName,
        DateTimeOffset? observedAt)
    {
        if (rssi.HasValue && (rssi.Value < -127 || rssi.Value > 0))
        {
            Add($"Skipped invalid RSSI value: {rssi.Value}.");
            return Task.CompletedTask;
        }

        if (!paired || string.IsNullOrWhiteSpace(pairingToken.Text))
            return Task.CompletedTask;

        var context = new RadioObservationContext(
            organizationId.Text.Trim(),
            examId.Text.Trim(),
            candidateId.Text.Trim(),
            attemptId.Text.Trim());
        var payload = new RadioObservationPayload(
            source,
            kind,
            rssi,
            pseudonym,
            advertisedName,
            status,
            errorCode,
            observedAt ?? DateTimeOffset.UtcNow);
        if (!radioOutbox.TryEnqueue(context, pairingToken.Text.Trim(), payload, DateTimeOffset.UtcNow))
        {
            SetRadioSyncStatus($"Backend sync: queue full ({radioOutbox.PendingCount} pending)");
            return Task.CompletedTask;
        }

        SetRadioSyncStatus($"Backend sync: queued ({radioOutbox.PendingCount} pending)");
        return Task.CompletedTask;
    }

    private async Task PumpRadioOutboxAsync(bool allowDuringPairing = false)
    {
        if (closing || IsDisposed)
            return;

        if (InvokeRequired)
        {
            try
            {
                await InvokeOnUiAsync(() => PumpRadioOutboxOnUiAsync(allowDuringPairing));
            }
            catch (ObjectDisposedException) when (closing || IsDisposed)
            {
            }
            catch (InvalidOperationException) when (closing || IsDisposed)
            {
            }
            return;
        }

        await PumpRadioOutboxOnUiAsync(allowDuringPairing);
    }

    private async Task PumpRadioOutboxOnUiAsync(bool allowDuringPairing)
    {
        if (closing || IsDisposed || pairingInProgress && !allowDuringPairing || radioOutbox.PendingCount == 0)
            return;

        try
        {
            var result = await radioOutbox.PumpAsync(async (batch, cancellationToken) =>
            {
                var contextMatches = string.Equals(batch.Context.OrganizationId, organizationId.Text.Trim(), StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(batch.Context.ExamId, examId.Text.Trim(), StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(batch.Context.CandidateId, candidateId.Text.Trim(), StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(batch.Context.AttemptId, attemptId.Text.Trim(), StringComparison.OrdinalIgnoreCase);
                var token = contextMatches && paired && !string.IsNullOrWhiteSpace(pairingToken.Text)
                    ? pairingToken.Text.Trim()
                    : batch.PairingToken;
                using var request = new HttpRequestMessage(
                    HttpMethod.Post,
                    $"{apiUrl.Text.TrimEnd('/')}/api/student/radio-observations/batch")
                {
                    Content = RadioObservationBatchContent.Create(batch)
                };
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                return await http.SendAsync(request, cancellationToken);
            }, DateTimeOffset.UtcNow, bridgeCancellation.Token, async (batch, response, cancellationToken) =>
            {
                if (response.IsSuccessStatusCode)
                    return;

                var body = await response.Content.ReadAsStringAsync(cancellationToken);
                var summary = CompanionApiErrorSummary.FromBody(
                    body,
                    response.Content.Headers.ContentType?.MediaType,
                    batch.PairingToken);
                Add($"Radio batch API rejected with HTTP {(int)response.StatusCode}: {summary}.");
            });

            if (result == OutboxPumpResult.Succeeded)
            {
                SetRadioSyncStatus($"Backend sync: synchronized ({radioOutbox.PendingCount} pending)");
            }
            else if (result == OutboxPumpResult.Retrying || result == OutboxPumpResult.Deferred)
            {
                SetRadioSyncStatus($"Backend sync: retry pending ({radioOutbox.PendingCount} queued)");
            }
            else if (result == OutboxPumpResult.Rejected)
            {
                SetRadioSyncStatus("Backend sync: rejected; reconnect Companion");
                Add("The backend rejected a radio batch; monitoring was stopped for safety.");
                radioOutbox.DiscardQueued();
                paired = false;
                pairingExpiresAt = null;
                await InvokeOnUiAsync(() => StopAsync(reportToServer: false));
            }

            if (radioOutbox.DroppedCount > reportedDroppedObservationCount)
            {
                var dropped = radioOutbox.DroppedCount - reportedDroppedObservationCount;
                reportedDroppedObservationCount = radioOutbox.DroppedCount;
                Add($"Radio observations dropped from the bounded queue or expired: {dropped}.");
            }
        }
        catch (OperationCanceledException) when (bridgeCancellation.IsCancellationRequested)
        {
        }
        catch (Exception ex)
        {
            SetRadioSyncStatus("Backend sync: retry pending");
            Add($"Radio batch upload failed: {ex.GetType().Name}.");
        }
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

    private void SetRadioSyncStatus(string value)
    {
        if (InvokeRequired)
        {
            BeginInvoke(() => SetRadioSyncStatus(value));
            return;
        }

        radioSyncStatus.Text = value;
    }

    internal void Add(string message)
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
            radioUploadTimer?.Dispose();
            bridgeCancellation.Cancel();
            bridge.Stop();
            if (bluetooth.Status == BluetoothLEAdvertisementWatcherStatus.Started)
                bluetooth.Stop();
            http.Dispose();
            trayIcon.Visible = false;
            trayIcon.Dispose();
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
