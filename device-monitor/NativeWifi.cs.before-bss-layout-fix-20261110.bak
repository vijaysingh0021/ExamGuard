using System.Runtime.InteropServices;

namespace ExamGuard.DeviceMonitor;

// Minimal, documented wlanapi.dll BSS enumeration. It does not enter monitor mode or inspect traffic.
internal static class NativeWifi
{
    internal record AccessPoint(string Bssid, int Rssi);
    public static IReadOnlyList<AccessPoint> Scan()
    {
        var code = WlanOpenHandle(2, IntPtr.Zero, out _, out var client); if (code != 0) throw new InvalidOperationException($"WlanOpenHandle failed: {code}");
        try { code = WlanEnumInterfaces(client, IntPtr.Zero, out var interfaces); if (code != 0) throw new InvalidOperationException($"WlanEnumInterfaces failed: {code}"); try { var header = Marshal.PtrToStructure<ListHeader>(interfaces); var size = Marshal.SizeOf<InterfaceInfo>(); var result = new List<AccessPoint>(); for (var i = 0; i < header.Count; i++) { var item = Marshal.PtrToStructure<InterfaceInfo>(IntPtr.Add(interfaces, Marshal.SizeOf<ListHeader>() + i * size)); WlanScan(client, ref item.Guid, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); Thread.Sleep(750); code = WlanGetNetworkBssList(client, ref item.Guid, IntPtr.Zero, Dot11BssType.Any, false, IntPtr.Zero, out var bss); if (code != 0) continue; try { var bssHeader = Marshal.PtrToStructure<ListHeader>(bss); var bssSize = Marshal.SizeOf<BssEntry>(); for (var j = 0; j < bssHeader.Count; j++) { var entry = Marshal.PtrToStructure<BssEntry>(IntPtr.Add(bss, Marshal.SizeOf<ListHeader>() + j * bssSize)); result.Add(new AccessPoint(string.Join(':', entry.Bssid.Select(x => x.ToString("X2"))), entry.Rssi)); } } finally { WlanFreeMemory(bss); } } return result; } finally { WlanFreeMemory(interfaces); } } finally { WlanCloseHandle(client, IntPtr.Zero); }
    }
    private enum Dot11BssType : uint { Infrastructure = 1, Independent = 2, Any = 3 }
    [StructLayout(LayoutKind.Sequential)] private struct ListHeader { public uint Count; public uint Index; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct InterfaceInfo { public Guid Guid; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Description; public uint State; }
    [StructLayout(LayoutKind.Sequential)] private struct BssEntry { [MarshalAs(UnmanagedType.ByValArray, SizeConst = 4)] public byte[] SsidHeader; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] Ssid; public uint PhyId; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)] public byte[] Bssid; public uint BssType; public uint PhyType; public int Rssi; public uint LinkQuality; public byte InRegDomain; public ushort BeaconPeriod; public long Timestamp; public long HostTimestamp; public ushort Capability; public uint IeOffset; public uint IeSize; }
    [DllImport("wlanapi.dll")] private static extern uint WlanOpenHandle(uint version, IntPtr reserved, out uint negotiated, out IntPtr client);
    [DllImport("wlanapi.dll")] private static extern uint WlanCloseHandle(IntPtr client, IntPtr reserved);
    [DllImport("wlanapi.dll")] private static extern uint WlanEnumInterfaces(IntPtr client, IntPtr reserved, out IntPtr list);
    [DllImport("wlanapi.dll")] private static extern uint WlanScan(IntPtr client, ref Guid interfaceGuid, IntPtr ssid, IntPtr ieData, IntPtr reserved);
    [DllImport("wlanapi.dll")] private static extern uint WlanGetNetworkBssList(IntPtr client, ref Guid interfaceGuid, IntPtr ssid, Dot11BssType bssType, [MarshalAs(UnmanagedType.Bool)] bool securityEnabled, IntPtr reserved, out IntPtr list);
    [DllImport("wlanapi.dll")] private static extern void WlanFreeMemory(IntPtr memory);
}
