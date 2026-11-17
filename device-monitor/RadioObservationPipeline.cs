using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;

namespace ExamGuard.DeviceMonitor;

internal sealed record RadioObservationContext(
    string OrganizationId,
    string ExamId,
    string CandidateId,
    string AttemptId);

internal sealed record RadioObservationPayload(
    string Source,
    string Kind,
    int? Rssi,
    string? Pseudonym,
    string? AdvertisedName,
    string ScannerStatus,
    string? ErrorCode,
    DateTimeOffset ObservedAt);

internal sealed record RadioObservationBatch(
    RadioObservationContext Context,
    string PairingToken,
    IReadOnlyList<RadioObservationPayload> Observations);

internal enum OutboxPumpResult
{
    Empty,
    Deferred,
    Succeeded,
    Retrying,
    Rejected
}

internal sealed class RadioObservationOutbox
{
    private sealed record QueuedObservation(
        RadioObservationContext Context,
        string PairingToken,
        RadioObservationPayload Observation,
        DateTimeOffset EnqueuedAt);

    private readonly object sync = new();
    private readonly LinkedList<QueuedObservation> queue = new();
    private readonly int capacity;
    private readonly int batchSize;
    private readonly TimeSpan observationLifetime;
    private int pumping;
    private int inFlightCount;
    private int retryCount;
    private DateTimeOffset nextAttemptAt;

    public RadioObservationOutbox(
        int capacity = 2048,
        int batchSize = 50,
        TimeSpan? observationLifetime = null)
    {
        if (capacity < 1) throw new ArgumentOutOfRangeException(nameof(capacity));
        if (batchSize < 1) throw new ArgumentOutOfRangeException(nameof(batchSize));
        this.capacity = capacity;
        this.batchSize = batchSize;
        this.observationLifetime = observationLifetime ?? TimeSpan.FromMinutes(10);
    }

    public int PendingCount
    {
        get { lock (sync) return queue.Count + inFlightCount; }
    }

    public long DroppedCount { get; private set; }

    public bool TryEnqueue(
        RadioObservationContext context,
        string pairingToken,
        RadioObservationPayload observation,
        DateTimeOffset enqueuedAt)
    {
        if (string.IsNullOrWhiteSpace(pairingToken))
            throw new ArgumentException("A pairing token is required.", nameof(pairingToken));

        lock (sync)
        {
            if (queue.Count + inFlightCount >= capacity)
            {
                DroppedCount++;
                return false;
            }
            queue.AddLast(new QueuedObservation(context, pairingToken, observation, enqueuedAt));
            return true;
        }
    }

    public void DiscardQueued()
    {
        lock (sync)
        {
            DroppedCount += queue.Count;
            queue.Clear();
        }
    }

    public async Task<OutboxPumpResult> PumpAsync(
        Func<RadioObservationBatch, CancellationToken, Task<HttpResponseMessage>> sendBatch,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        if (Interlocked.CompareExchange(ref pumping, 1, 0) != 0)
            return OutboxPumpResult.Deferred;

        try
        {
            if (now < nextAttemptAt)
                return OutboxPumpResult.Deferred;

            var batch = TakeBatch(now);
            if (batch is null)
                return OutboxPumpResult.Empty;

            try
            {
                using var response = await sendBatch(batch, cancellationToken);
                var status = (int)response.StatusCode;
                if (response.IsSuccessStatusCode)
                {
                    CompleteBatch(batch);
                    retryCount = 0;
                    nextAttemptAt = DateTimeOffset.MinValue;
                    return OutboxPumpResult.Succeeded;
                }

                if (status == 401 || status == 403 || status < 500 && status != 429)
                {
                    DropBatch(batch);
                    return OutboxPumpResult.Rejected;
                }

                ScheduleRetry(response.Headers.RetryAfter, now);
                RequeueFront(batch);
                return OutboxPumpResult.Retrying;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                RequeueFront(batch);
                throw;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
                ScheduleRetry(null, now);
                RequeueFront(batch);
                return OutboxPumpResult.Retrying;
            }
            catch
            {
                RequeueFront(batch);
                throw;
            }
        }
        finally
        {
            Volatile.Write(ref pumping, 0);
        }
    }

    private RadioObservationBatch? TakeBatch(DateTimeOffset now)
    {
        lock (sync)
        {
            while (queue.First is { } first &&
                   now - first.Value.EnqueuedAt > observationLifetime)
            {
                queue.RemoveFirst();
                DroppedCount++;
            }

            if (queue.First is not { } head)
                return null;

            var context = head.Value.Context;
            var token = head.Value.PairingToken;
            var observations = new List<RadioObservationPayload>(batchSize);
            while (observations.Count < batchSize &&
                   queue.First is { } next &&
                   next.Value.Context == context &&
                   string.Equals(next.Value.PairingToken, token, StringComparison.Ordinal))
            {
                observations.Add(next.Value.Observation);
                queue.RemoveFirst();
            }
            inFlightCount += observations.Count;

            return new RadioObservationBatch(context, token, observations);
        }
    }

    private void DropBatch(RadioObservationBatch batch)
    {
        lock (sync)
        {
            inFlightCount -= batch.Observations.Count;
            DroppedCount += batch.Observations.Count;
        }
    }

    private void RequeueFront(RadioObservationBatch batch)
    {
        lock (sync)
        {
            for (var index = batch.Observations.Count - 1; index >= 0; index--)
                queue.AddFirst(new QueuedObservation(batch.Context, batch.PairingToken, batch.Observations[index], batch.Observations[index].ObservedAt));
            inFlightCount -= batch.Observations.Count;
        }
    }

    private void CompleteBatch(RadioObservationBatch batch)
    {
        lock (sync)
            inFlightCount -= batch.Observations.Count;
    }

    private void ScheduleRetry(RetryConditionHeaderValue? retryAfter, DateTimeOffset now)
    {
        retryCount = Math.Min(retryCount + 1, 6);
        var exponentialSeconds = Math.Min(60, Math.Pow(2, retryCount - 1));
        var requestedDelay = retryAfter?.Delta ??
            (retryAfter?.Date is { } retryDate ? retryDate - now : TimeSpan.FromSeconds(exponentialSeconds));
        var delay = requestedDelay < TimeSpan.Zero
            ? TimeSpan.Zero
            : requestedDelay > TimeSpan.FromMinutes(1)
                ? TimeSpan.FromMinutes(1)
                : requestedDelay;
        nextAttemptAt = now + delay;
    }
}

internal sealed class RadioObservationSampler
{
    private readonly object sync = new();
    private readonly Dictionary<(string Source, string Pseudonym), DateTimeOffset> lastObserved = new();
    private readonly TimeSpan minimumInterval;
    private readonly int maximumTrackedPseudonyms;

    public RadioObservationSampler(
        TimeSpan? minimumInterval = null,
        int maximumTrackedPseudonyms = 4096)
    {
        if (maximumTrackedPseudonyms < 1)
            throw new ArgumentOutOfRangeException(nameof(maximumTrackedPseudonyms));
        this.minimumInterval = minimumInterval ?? TimeSpan.FromSeconds(5);
        this.maximumTrackedPseudonyms = maximumTrackedPseudonyms;
    }

    public bool ShouldAccept(string source, string pseudonym, DateTimeOffset observedAt)
    {
        lock (sync)
        {
            foreach (var expired in lastObserved
                         .Where(item => observedAt - item.Value > TimeSpan.FromMinutes(10))
                         .Select(item => item.Key)
                         .ToArray())
                lastObserved.Remove(expired);

            var key = (source, pseudonym);
            if (lastObserved.TryGetValue(key, out var previous) &&
                observedAt - previous < minimumInterval)
                return false;

            if (!lastObserved.ContainsKey(key) && lastObserved.Count >= maximumTrackedPseudonyms)
            {
                var oldest = lastObserved.MinBy(item => item.Value).Key;
                lastObserved.Remove(oldest);
            }
            lastObserved[key] = observedAt;
            return true;
        }
    }
}

internal static class RadioPrivacy
{
    public static string Pseudonym(string sessionSalt, string rawIdentifier)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(sessionSalt));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(rawIdentifier)))
            .ToLowerInvariant();
    }
}

internal static class WifiObservationSelection
{
    public static IReadOnlyList<NativeWifi.AccessPoint> StrongestPerBssid(
        IEnumerable<NativeWifi.AccessPoint> accessPoints)
    {
        return accessPoints
            .GroupBy(accessPoint => accessPoint.Bssid, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.MaxBy(accessPoint => accessPoint.Rssi)!)
            .OrderByDescending(accessPoint => accessPoint.Rssi)
            .ThenBy(accessPoint => accessPoint.Bssid, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }
}
