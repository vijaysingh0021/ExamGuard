using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace ExamGuard.DeviceMonitor;

internal static class NativeWifi
{
    private const int ScanTimeoutMilliseconds = 10_000;
    private const int OverallScanTimeoutMilliseconds = 30_000;
    private const uint WlanNotificationSourceAcm = 0x00000008;
    private const uint WlanNotificationAcmScanComplete = 7;
    private const uint WlanNotificationAcmScanFail = 8;
    private const uint ErrorNotFound = 1168;
    private const uint ErrorAccessDenied = 5;
    private const uint ErrorServiceNotActive = 1062;
    private const uint ErrorDeviceNotConnected = 1167;
    private const uint ErrorDeviceNotAvailable = 4319;

    internal sealed record AccessPoint(string Bssid, int Rssi);
    internal sealed record ScanFailure(string Category, string Code);
    internal sealed record ScanResult(
        IReadOnlyList<AccessPoint> AccessPoints,
        int TotalInterfaces,
        int SuccessfulInterfaces,
        IReadOnlyList<ScanFailure> Failures,
        DateTimeOffset CompletedAt);

    private static readonly ConcurrentQueue<string> DiagnosticQueue = new();

    internal static IReadOnlyList<string> DrainDiagnostics()
    {
        var messages = new List<string>();
        while (DiagnosticQueue.TryDequeue(out var message))
            messages.Add(message);
        return messages;
    }

    internal static string ClassifyStatus(ScanResult result)
    {
        if (result.SuccessfulInterfaces > 0)
        {
            if (result.Failures.Count == 0) return "active";
            return result.Failures.Any(failure => failure.Category == "permission_denied")
                ? "permission_denied"
                : "error";
        }
        if (result.Failures.Any(failure => failure.Category == "permission_denied"))
            return "permission_denied";
        return result.Failures.Count > 0 && result.Failures.All(failure => failure.Category == "unavailable")
            ? "unavailable"
            : "error";
    }

    public static ScanResult Scan()
    {
        var code = WlanOpenHandle(2, IntPtr.Zero, out _, out var client);
        if (code != 0)
            throw new WlanApiException("WlanOpenHandle", code);

        try
        {
            code = WlanEnumInterfaces(client, IntPtr.Zero, out var interfaces);
            if (code != 0)
                throw new WlanApiException("WlanEnumInterfaces", code);

            try
            {
                var header = Marshal.PtrToStructure<ListHeader>(interfaces);
                var interfaceSize = Marshal.SizeOf<InterfaceInfo>();
                var headerSize = Marshal.SizeOf<ListHeader>();
                var result = new List<AccessPoint>();
                var failures = new List<ScanFailure>();
                if (header.Count == 0)
                    return new ScanResult(result, 0, 0, [new ScanFailure("unavailable", "no_wireless_interfaces")], DateTimeOffset.UtcNow);

                var pendingScans = new ConcurrentDictionary<Guid, WlanScanCompletion>();
                WlanNotificationCallback callback = (ref NotificationData notification, IntPtr _) =>
                {
                    if (notification.NotificationSource != NotificationSource.Acm ||
                        notification.NotificationCode is not (WlanNotificationAcmScanComplete or WlanNotificationAcmScanFail))
                        return;
                    if (pendingScans.TryGetValue(notification.InterfaceGuid, out var completion))
                        completion.Complete(notification.NotificationCode);
                };
                code = WlanRegisterNotification(
                    client,
                    WlanNotificationSourceAcm,
                    true,
                    callback,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    out _);
                if (code != 0)
                    throw new WlanApiException("WlanRegisterNotification", code);

                try
                {
                    var completedInterfaces = 0;
                    var timer = Stopwatch.StartNew();
                    var totalInterfaces = checked((int)header.Count);
                    for (var index = 0; index < totalInterfaces; index++)
                    {
                        if (timer.ElapsedMilliseconds >= OverallScanTimeoutMilliseconds)
                        {
                            failures.Add(new ScanFailure("error", "overall_scan_timeout"));
                            break;
                        }

                        var item = Marshal.PtrToStructure<InterfaceInfo>(
                            IntPtr.Add(interfaces, headerSize + index * interfaceSize));
                        var completion = new WlanScanCompletion();
                        pendingScans[item.Guid] = completion;
                        code = WlanScan(client, ref item.Guid, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                        if (code != 0)
                        {
                            pendingScans.TryRemove(item.Guid, out _);
                            failures.Add(new ScanFailure(ClassifyFailure(code), $"scan_request_failed:{code}"));
                            DiagnosticQueue.Enqueue($"WlanScan returned {code} for interface {index}.");
                            continue;
                        }

                        var remaining = Math.Min(
                            ScanTimeoutMilliseconds,
                            OverallScanTimeoutMilliseconds - (int)timer.ElapsedMilliseconds);
                        if (remaining <= 0 ||
                            !completion.Wait(TimeSpan.FromMilliseconds(remaining), out var notificationCode))
                        {
                            pendingScans.TryRemove(item.Guid, out _);
                            failures.Add(new ScanFailure("error", "scan_completion_timeout"));
                            DiagnosticQueue.Enqueue($"WLAN scan completion timed out for interface {index}.");
                            continue;
                        }
                        pendingScans.TryRemove(item.Guid, out _);
                        if (notificationCode != WlanNotificationAcmScanComplete)
                        {
                            failures.Add(new ScanFailure("error", "scan_failed"));
                            DiagnosticQueue.Enqueue($"WLAN scan failed for interface {index}.");
                            continue;
                        }

                        var queriesSucceeded = true;
                        foreach (var securityEnabled in new[] { false, true })
                        {
                            code = WlanGetNetworkBssList(
                                client,
                                ref item.Guid,
                                IntPtr.Zero,
                                Dot11BssType.Any,
                                securityEnabled,
                                IntPtr.Zero,
                                out var bss);
                            if (code == ErrorNotFound)
                                continue;
                            if (code != 0 || bss == IntPtr.Zero)
                            {
                                queriesSucceeded = false;
                                failures.Add(new ScanFailure(ClassifyFailure(code), $"bss_query_failed:{code}"));
                                DiagnosticQueue.Enqueue($"BSS query returned {code} for interface {index}.");
                                continue;
                            }

                            try
                            {
                                ParseBssList(bss, result);
                            }
                            catch (InvalidOperationException)
                            {
                                queriesSucceeded = false;
                                failures.Add(new ScanFailure("error", "invalid_bss_list"));
                                DiagnosticQueue.Enqueue($"BSS list was invalid for interface {index}.");
                            }

                            finally
                            {
                                WlanFreeMemory(bss);
                            }
                        }

                        if (queriesSucceeded)
                            completedInterfaces++;
                    }

                    var selected = WifiObservationSelection.StrongestPerBssid(result);
                    return new ScanResult(
                        selected,
                        totalInterfaces,
                        completedInterfaces,
                        failures,
                        DateTimeOffset.UtcNow);
                }
                finally
                {
                    WlanRegisterNotification(
                        client,
                        0,
                        true,
                        null,
                        IntPtr.Zero,
                        IntPtr.Zero,
                        out _);
                    GC.KeepAlive(callback);
                }
            }
            finally
            {
                WlanFreeMemory(interfaces);
            }
        }
        finally
        {
            WlanCloseHandle(client, IntPtr.Zero);
        }
    }

    private static string ClassifyFailure(uint code) => code switch
    {
        ErrorAccessDenied => "permission_denied",
        ErrorServiceNotActive or ErrorDeviceNotConnected or ErrorDeviceNotAvailable => "unavailable",
        _ => "error",
    };

    private static void ParseBssList(IntPtr bss, ICollection<AccessPoint> results)
    {
        var bssHeader = Marshal.PtrToStructure<BssListHeader>(bss);
        var bssSize = Marshal.SizeOf<BssEntry>();
        var headerSize = Marshal.SizeOf<BssListHeader>();
        if (bssHeader.TotalSize < headerSize)
            throw new InvalidOperationException("Invalid WLAN BSS list size.");

        var maximumEntries = (bssHeader.TotalSize - headerSize) / bssSize;
        var entryCount = Math.Min(bssHeader.NumberOfItems, maximumEntries);
        for (var index = 0; index < entryCount; index++)
        {
            var entry = Marshal.PtrToStructure<BssEntry>(
                IntPtr.Add(bss, headerSize + checked((int)index * bssSize)));
            if (entry.Bssid == null || entry.Bssid.Length != 6 ||
                entry.Rssi < -127 || entry.Rssi > 0)
                continue;

            var bssid = string.Join(":", entry.Bssid.Select(value => value.ToString("X2")));
            results.Add(new AccessPoint(bssid, entry.Rssi));
        }
    }

    private enum Dot11BssType : uint
    {
        Infrastructure = 1,
        Independent = 2,
        Any = 3
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ListHeader
    {
        public uint Count;
        public uint Index;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BssListHeader
    {
        public uint TotalSize;
        public uint NumberOfItems;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct InterfaceInfo
    {
        public Guid Guid;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string Description;

        public uint State;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WlanRateSet
    {
        public uint RateSetLength;

        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 126)]
        public ushort[] Rates;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BssEntry
    {
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 4)]
        public byte[] SsidHeader;

        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
        public byte[] Ssid;

        public uint PhyId;

        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)]
        public byte[] Bssid;

        public uint BssType;
        public uint PhyType;
        public int Rssi;
        public uint LinkQuality;
        public byte InRegDomain;
        public ushort BeaconPeriod;
        public long Timestamp;
        public long HostTimestamp;
        public ushort Capability;
        public uint CenterFrequency;
        public WlanRateSet RateSet;
        public uint IeOffset;
        public uint IeSize;
    }

    private enum NotificationSource : uint
    {
        Acm = WlanNotificationSourceAcm
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NotificationData
    {
        public NotificationSource NotificationSource;
        public uint NotificationCode;
        public Guid InterfaceGuid;
        public uint DataSize;
        public IntPtr Data;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate void WlanNotificationCallback(ref NotificationData data, IntPtr context);

    [DllImport("wlanapi.dll")]
    private static extern uint WlanOpenHandle(uint version, IntPtr reserved, out uint negotiated, out IntPtr client);

    [DllImport("wlanapi.dll")]
    private static extern uint WlanCloseHandle(IntPtr client, IntPtr reserved);

    [DllImport("wlanapi.dll")]
    private static extern uint WlanEnumInterfaces(IntPtr client, IntPtr reserved, out IntPtr list);

    [DllImport("wlanapi.dll")]
    private static extern uint WlanScan(IntPtr client, ref Guid interfaceGuid, IntPtr ssid, IntPtr ieData, IntPtr reserved);

    [DllImport("wlanapi.dll")]
    private static extern uint WlanGetNetworkBssList(
        IntPtr client,
        ref Guid interfaceGuid,
        IntPtr ssid,
        Dot11BssType bssType,
        [MarshalAs(UnmanagedType.Bool)] bool securityEnabled,
        IntPtr reserved,
        out IntPtr list);

    [DllImport("wlanapi.dll")]
    private static extern void WlanFreeMemory(IntPtr memory);

    [DllImport("wlanapi.dll")]
    private static extern uint WlanRegisterNotification(
        IntPtr client,
        uint notificationSource,
        [MarshalAs(UnmanagedType.Bool)] bool ignoreDuplicate,
        WlanNotificationCallback? callback,
        IntPtr context,
        IntPtr reserved,
        out uint previousSource);
}

internal sealed class WlanApiException(string operation, uint errorCode)
    : InvalidOperationException($"{operation} failed with Windows WLAN error {errorCode}.")
{
    public string Category => errorCode switch
    {
        5 => "permission_denied",
        1062 or 1167 or 4319 => "unavailable",
        _ => "error",
    };

    public string ErrorCode => $"{operation}:{errorCode}";
}

internal sealed class WlanScanCompletion
{
    private readonly TaskCompletionSource<uint> completion =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public void Complete(uint notificationCode) => completion.TrySetResult(notificationCode);

    public bool Wait(TimeSpan timeout, out uint notificationCode)
    {
        if (completion.Task.Wait(timeout))
        {
            notificationCode = completion.Task.GetAwaiter().GetResult();
            return true;
        }
        notificationCode = 0;
        return false;
    }
}
