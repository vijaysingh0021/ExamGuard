using ExamGuard.DeviceMonitor;

var now = DateTimeOffset.UtcNow;
var sessions = new BridgeAuthorizationSessions();
var tokenA = $"Bearer {new string('a', 64)}";
var tokenB = $"Bearer {new string('b', 64)}";
var mismatchedSessionToken = $"Bearer {new string('c', 64)}";

Assert(!sessions.Authorize(null, allowRegistration: true, now: now), "Missing bearer tokens must be rejected.");
Assert(!sessions.Authorize("Bearer malformed", allowRegistration: true, now: now), "Invalid bearer tokens must be rejected.");
Assert(sessions.Authorize(tokenA, allowRegistration: true, now: now), "A valid browser token must register.");
Assert(sessions.Authorize(tokenA, allowRegistration: false, now: now.AddMinutes(1)), "A registered browser token must authorize protected requests.");
Assert(sessions.Authorize(tokenB, allowRegistration: true, now: now.AddMinutes(1)), "A second browser tab must register an independent token.");
Assert(sessions.Authorize(tokenB, allowRegistration: false, now: now.AddMinutes(2)), "The second tab token must authorize protected requests.");
Assert(sessions.Authorize(tokenA, allowRegistration: false, now: now.AddMinutes(2)), "Registering another tab must not invalidate the first browser session.");
Assert(!sessions.Authorize(mismatchedSessionToken, allowRegistration: false, now: now.AddMinutes(2)), "A token registered to a different browser session must not authorize protected requests.");
Assert(!sessions.Authorize(tokenA, allowRegistration: false, now: now.AddMinutes(33)), "An idle-expired token must be rejected on protected requests.");
Assert(sessions.Authorize(tokenA, allowRegistration: true, now: now.AddMinutes(33)), "A health check may re-register its browser token after idle expiry.");
Assert(sessions.Authorize(tokenA, allowRegistration: false, now: now.AddMinutes(34)), "A re-registered token must authorize protected requests.");
var restartedSessions = new BridgeAuthorizationSessions();
Assert(restartedSessions.Authorize(tokenA, allowRegistration: true, now: now.AddMinutes(35)), "A browser refresh after Companion restart may register its token again.");
Assert(restartedSessions.Authorize(tokenA, allowRegistration: false, now: now.AddMinutes(36)), "The re-registered token must authorize protected routes after restart.");

Console.WriteLine("PASS: missing, malformed, valid, independent browser sessions, mismatched-session, idle-expiry, and Companion-restart registration.");

TestBluetoothLifecycle();
TestPseudonymsAndSampling();
TestWifiSelection();
TestWlanCompletion();
TestWifiStatus();
await TestRadioBatchSerialization();
await TestObservationOutbox();

static void TestBluetoothLifecycle()
{
    Assert(BluetoothWatcherLifecycle.PlanStart(BluetoothWatcherState.Created) == BluetoothWatcherStartAction.Start, "A new BLE watcher must start from Created.");
    Assert(BluetoothWatcherLifecycle.PlanStart(BluetoothWatcherState.Stopped) == BluetoothWatcherStartAction.Start, "A stopped BLE watcher may start again.");
    Assert(BluetoothWatcherLifecycle.PlanStart(BluetoothWatcherState.Started) == BluetoothWatcherStartAction.StopAndWait, "An already-started watcher must stop and settle before a new session starts.");
    Assert(BluetoothWatcherLifecycle.PlanStart(BluetoothWatcherState.Stopping) == BluetoothWatcherStartAction.WaitForStop, "A stopping watcher must finish its asynchronous transition before restart.");
    Assert(BluetoothWatcherLifecycle.PlanStart(BluetoothWatcherState.Aborted) == BluetoothWatcherStartAction.Recreate, "An aborted watcher must be replaced rather than started again.");
    Assert(BluetoothWatcherLifecycle.PlanStart(BluetoothWatcherState.Unknown) == BluetoothWatcherStartAction.Fail, "Unknown watcher states must fail closed.");
    Assert(BluetoothWatcherLifecycle.ClassifyStartFailure(new InvalidOperationException(), true, true, true, "On") == "error", "An invalid watcher lifecycle state must not be mislabeled as missing hardware.");
    Assert(BluetoothWatcherLifecycle.ClassifyStartFailure(new UnauthorizedAccessException(), true, true, true, "On") == "permission_denied", "Access failures must remain permission errors.");
    Assert(BluetoothWatcherLifecycle.ClassifyStartFailure(new InvalidOperationException(), false, false, false, null) == "unavailable", "A missing radio must be reported as unavailable.");
    Assert(BluetoothWatcherLifecycle.ClassifyStartFailure(new InvalidOperationException(), true, false, true, "On") == "unavailable", "An adapter without LE availability must be reported as unavailable.");
    Assert(BluetoothWatcherLifecycle.ClassifyStartFailure(new InvalidOperationException(), true, true, true, "Off") == "unavailable", "A powered-off radio must be reported as unavailable.");
    Console.WriteLine("PASS: BLE Created/Started/Stopping/Stopped/Aborted lifecycle plans and failure classification.");
}

static void TestPseudonymsAndSampling()
{
    var testNow = DateTimeOffset.UtcNow;
    var sameSession = RadioPrivacy.Pseudonym("session-a", "raw-address");
    Assert(sameSession == RadioPrivacy.Pseudonym("session-a", "raw-address"), "A session pseudonym must be stable for repeated raw identifiers in one session.");
    Assert(sameSession != RadioPrivacy.Pseudonym("session-b", "raw-address"), "Pseudonyms must not be linkable across session salts.");
    Assert(!sameSession.Contains("raw-address", StringComparison.Ordinal), "Pseudonyms must not contain the raw identifier.");

    var sampler = new RadioObservationSampler(TimeSpan.FromSeconds(5));
    Assert(sampler.ShouldAccept("bluetooth_le", sameSession, testNow), "The first observation must be accepted.");
    Assert(!sampler.ShouldAccept("bluetooth_le", sameSession, testNow.AddSeconds(1)), "Duplicate advertisements inside the sampling interval must be coalesced.");
    Assert(sampler.ShouldAccept("bluetooth_le", sameSession, testNow.AddSeconds(5)), "A later sample must be accepted.");
    Assert(sampler.ShouldAccept("wifi", sameSession, testNow.AddSeconds(1)), "Sampling one radio source must not suppress another source.");

    var boundedSampler = new RadioObservationSampler(TimeSpan.FromSeconds(5), maximumTrackedPseudonyms: 2);
    Assert(boundedSampler.ShouldAccept("bluetooth_le", "pseudonym-a", testNow), "A bounded sampler must accept its first pseudonym.");
    Assert(boundedSampler.ShouldAccept("bluetooth_le", "pseudonym-b", testNow.AddSeconds(1)), "A bounded sampler must accept a second pseudonym.");
    Assert(boundedSampler.ShouldAccept("bluetooth_le", "pseudonym-c", testNow.AddSeconds(2)), "The sampler must evict the oldest deduplication entry at capacity.");
    Assert(boundedSampler.ShouldAccept("bluetooth_le", "pseudonym-a", testNow.AddSeconds(3)), "The evicted entry must no longer consume deduplication memory.");
    Console.WriteLine("PASS: session-scoped pseudonyms and bounded per-pseudonym sampling.");
}

static void TestWifiSelection()
{
    var selected = WifiObservationSelection.StrongestPerBssid(new[]
    {
        new NativeWifi.AccessPoint("AA:BB:CC:DD:EE:FF", -70),
        new NativeWifi.AccessPoint("aa:bb:cc:dd:ee:ff", -55),
        new NativeWifi.AccessPoint("11:22:33:44:55:66", -80),
    });
    Assert(selected.Count == 2, "Wi-Fi results must deduplicate case-insensitive BSSIDs.");
    Assert(selected[0].Rssi == -55, "The documented selection policy must retain the strongest RSSI for a duplicated BSSID.");
    Assert(selected[1].Rssi == -80, "All distinct access points must be retained without a first-20 truncation.");
    Console.WriteLine("PASS: strongest-RSSI BSSID deduplication retains all unique access points.");
}

static void TestWlanCompletion()
{
    var completed = new WlanScanCompletion();
    completed.Complete(7);
    Assert(completed.Wait(TimeSpan.FromMilliseconds(20), out var completionCode) && completionCode == 7, "WLAN scan completion notifications must release the waiter.");
    var timedOut = new WlanScanCompletion();
    Assert(!timedOut.Wait(TimeSpan.FromMilliseconds(1), out _), "Missing WLAN scan completion must time out.");
    Console.WriteLine("PASS: WLAN completion notification and bounded-timeout handling.");
}

static void TestWifiStatus()
{
    Assert(new WlanApiException("test", 5).Category == "permission_denied", "WLAN access-denied errors must be reported as permission problems.");
    Assert(new WlanApiException("test", 1062).Category == "unavailable", "An inactive WLAN service must be reported as unavailable hardware/service.");

    var emptySuccess = new NativeWifi.ScanResult(
        Array.Empty<NativeWifi.AccessPoint>(),
        1,
        1,
        Array.Empty<NativeWifi.ScanFailure>(),
        DateTimeOffset.UtcNow);
    Assert(NativeWifi.ClassifyStatus(emptySuccess) == "active", "A completed empty scan must be distinguished from an API failure.");

    var failedScan = new NativeWifi.ScanResult(
        Array.Empty<NativeWifi.AccessPoint>(),
        1,
        0,
        new[] { new NativeWifi.ScanFailure("error", "scan_completion_timeout") },
        DateTimeOffset.UtcNow);
    Assert(NativeWifi.ClassifyStatus(failedScan) == "error", "A scan with no successful interface and an API failure must not look like an empty success.");

    var permissionFailure = new NativeWifi.ScanResult(
        Array.Empty<NativeWifi.AccessPoint>(),
        1,
        0,
        new[] { new NativeWifi.ScanFailure("permission_denied", "access_denied") },
        DateTimeOffset.UtcNow);
    Assert(NativeWifi.ClassifyStatus(permissionFailure) == "permission_denied", "Permission failures must be reported separately.");
    Console.WriteLine("PASS: successful empty Wi-Fi scans, scan failures, and permission errors are distinguished.");
}

static async Task TestObservationOutbox()
{
    var testNow = DateTimeOffset.UtcNow;
    var outbox = new RadioObservationOutbox(capacity: 3, batchSize: 2);
    var context = new RadioObservationContext("org", "exam", "candidate", "attempt");
    var timestamp = testNow;
    RadioObservationPayload Record(int sequence) => new(
        "bluetooth_le",
        "advertisement",
        -60 - sequence,
        $"pseudonym-{sequence}",
        null,
        "active",
        null,
        timestamp.AddSeconds(sequence));

    Assert(outbox.TryEnqueue(context, "token", Record(1), timestamp), "The first queued observation must fit.");
    Assert(outbox.TryEnqueue(context, "token", Record(2), timestamp), "The second queued observation must fit.");
    Assert(outbox.TryEnqueue(context, "token", Record(3), timestamp), "The third queued observation must fit.");
    Assert(!outbox.TryEnqueue(context, "token", Record(4), timestamp), "The bounded queue must reject overflow.");
    Assert(outbox.DroppedCount == 1, "Queue overflow must be observable as a dropped count.");

    var batches = 0;
    var limited = await outbox.PumpAsync((batch, _) =>
    {
        batches++;
        Assert(batch.Observations.Count == 2, "The outbox must batch observations up to the configured size.");
        var response = new HttpResponseMessage(System.Net.HttpStatusCode.TooManyRequests);
        response.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.FromSeconds(2));
        return Task.FromResult(response);
    }, timestamp);
    Assert(limited == OutboxPumpResult.Retrying && outbox.PendingCount == 3, "HTTP 429 must retain the batch for retry.");
    var deferred = await outbox.PumpAsync((_, _) => throw new InvalidOperationException("The retry delay was ignored."), timestamp.AddSeconds(1));
    Assert(deferred == OutboxPumpResult.Deferred, "Retry-After must be honored.");
    var retried = await outbox.PumpAsync((batch, _) =>
    {
        Assert(batch.Observations.Count == 2, "A retried batch must preserve its contents.");
        return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.Created));
    }, timestamp.AddSeconds(2));
    Assert(retried == OutboxPumpResult.Succeeded && outbox.PendingCount == 1, "A successful retry must clear only the acknowledged batch.");
    var finalBatch = await outbox.PumpAsync((batch, _) =>
    {
        Assert(batch.Observations.Count == 1, "Remaining observations must be sent in the final partial batch.");
        return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.Created));
    }, timestamp.AddSeconds(3));
    Assert(finalBatch == OutboxPumpResult.Succeeded && outbox.PendingCount == 0, "The queue must empty after all batches are acknowledged.");
    Assert(batches == 1, "The first limited request should be attempted once.");

    Assert(outbox.TryEnqueue(context, "token", Record(5), timestamp), "A new observation must fit after acknowledgments.");
    outbox.DiscardQueued();
    Assert(outbox.PendingCount == 0 && outbox.DroppedCount == 2, "Discarding a rejected attempt must clear and count all queued observations.");
    Console.WriteLine("PASS: bounded batching, HTTP 429 Retry-After, and successful batch acknowledgment.");
}

static async Task TestRadioBatchSerialization()
{
    var batch = new RadioObservationBatch(
        new RadioObservationContext(
            "a9c1d9e8-66c1-4f4a-81a2-12cfa785a301",
            "76dc2647-9c2c-4bd0-9a9e-cc1e498601dd",
            "f19aa211-1cbc-4c42-981f-57dd5d2f3e99",
            "321bead6-eaed-424b-813f-6a9c2eb97ea3"),
        "pairing-token-must-not-be-in-body",
        new[]
        {
            new RadioObservationPayload(
                "bluetooth_le",
                "advertisement",
                -61,
                "session-pseudonym-123456",
                null,
                "active",
                null,
                DateTimeOffset.Parse("2025-01-02T03:04:05.0000000+00:00")),
        });
    using var content = RadioObservationBatchContent.Create(batch);
    var json = await content.ReadAsStringAsync();
    using var document = System.Text.Json.JsonDocument.Parse(json);
    var root = document.RootElement;
    Assert(root.GetProperty("organizationId").GetString() == "a9c1d9e8-66c1-4f4a-81a2-12cfa785a301", "Batch context must use backend-compatible camelCase names and UUID values.");
    Assert(root.GetProperty("attemptId").GetString() == "321bead6-eaed-424b-813f-6a9c2eb97ea3", "Attempt context must be serialized.");
    var observation = root.GetProperty("observations")[0];
    Assert(observation.GetProperty("source").GetString() == "bluetooth_le", "Observation source must be serialized in the backend schema.");
    Assert(observation.GetProperty("kind").GetString() == "advertisement", "Observation kind must be serialized in the backend schema.");
    Assert(observation.GetProperty("rssi").GetInt32() == -61, "Actual RSSI must be serialized as an integer.");
    Assert(observation.GetProperty("pseudonym").GetString() == "session-pseudonym-123456", "The session pseudonym must be serialized.");
    Assert(observation.GetProperty("scannerStatus").GetString() == "active", "Scanner status must use the backend-compatible field name.");
    Assert(observation.GetProperty("observedAt").GetString() == "2025-01-02T03:04:05+00:00", "Observation timestamps must serialize as ISO timestamps.");
    Assert(!observation.TryGetProperty("advertisedName", out _), "Missing optional advertised names must be omitted rather than represented as null.");
    Assert(!json.Contains("pairing-token-must-not-be-in-body", StringComparison.Ordinal), "Pairing credentials must stay in the authorization header, not the batch body.");
    Assert(CompanionApiErrorSummary.FromBody("{\"error\":\"Attempt is no longer active\"}", "application/json") == "Attempt is no longer active", "JSON API rejection details must be retained for local diagnostics.");
    Assert(CompanionApiErrorSummary.FromBody("{\"error\":\"Rejected pairing-token-secret\"}", "application/json", "pairing-token-secret") == "Rejected [redacted]", "API diagnostics must redact any echoed credential.");
    Assert(CompanionApiErrorSummary.FromBody("<html>private upstream detail</html>", "text/html") == "non-JSON error response (text/html)", "Non-JSON upstream bodies must not be copied into Companion logs.");
    Console.WriteLine("PASS: batch payload serialization matches backend field names and excludes credentials.");
}

static void Assert(bool condition, string message)
{
    if (!condition)
        throw new InvalidOperationException(message);
}
