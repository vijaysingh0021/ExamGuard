namespace ExamGuard.DeviceMonitor;

internal enum BluetoothWatcherState
{
    Created,
    Started,
    Stopping,
    Stopped,
    Aborted,
    Unknown
}

internal enum BluetoothWatcherStartAction
{
    Start,
    StopAndWait,
    WaitForStop,
    Recreate,
    Fail
}

internal static class BluetoothWatcherLifecycle
{
    public static BluetoothWatcherStartAction PlanStart(BluetoothWatcherState state) => state switch
    {
        BluetoothWatcherState.Created or BluetoothWatcherState.Stopped => BluetoothWatcherStartAction.Start,
        BluetoothWatcherState.Started => BluetoothWatcherStartAction.StopAndWait,
        BluetoothWatcherState.Stopping => BluetoothWatcherStartAction.WaitForStop,
        BluetoothWatcherState.Aborted => BluetoothWatcherStartAction.Recreate,
        _ => BluetoothWatcherStartAction.Fail,
    };

    public static string ClassifyStartFailure(
        Exception exception,
        bool? adapterFound,
        bool? lowEnergyAvailable,
        bool? supportsLeCentral,
        string? radioState)
    {
        if (exception is UnauthorizedAccessException ||
            exception.HResult == unchecked((int)0x80070005))
            return "permission_denied";

        if (adapterFound == false ||
            lowEnergyAvailable == false ||
            supportsLeCentral == false ||
            string.Equals(radioState, "Off", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(radioState, "Disabled", StringComparison.OrdinalIgnoreCase))
            return "unavailable";

        return "error";
    }
}
