using System.Security.Cryptography;

namespace ExamGuard.DeviceMonitor;

internal sealed class BridgeAuthorizationSessions
{
    private const int TokenByteLength = 32;
    private const int MaximumSessions = 32;
    private static readonly TimeSpan IdleTimeout = TimeSpan.FromMinutes(30);

    private readonly object sync = new();
    private readonly List<Session> sessions = [];

    public bool Authorize(string? authorization, bool allowRegistration, DateTimeOffset now)
    {
        const string prefix = "Bearer ";
        if (authorization is null || !authorization.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            return false;

        var token = authorization[prefix.Length..].Trim();
        if (token.Length != TokenByteLength * 2)
            return false;

        byte[] supplied;
        try { supplied = Convert.FromHexString(token); }
        catch (FormatException) { return false; }

        var retained = false;
        try
        {
            lock (sync)
            {
                for (var index = sessions.Count - 1; index >= 0; index--)
                {
                    if (now - sessions[index].LastSeen < IdleTimeout)
                        continue;
                    CryptographicOperations.ZeroMemory(sessions[index].Token);
                    sessions.RemoveAt(index);
                }

                foreach (var session in sessions)
                {
                    if (!CryptographicOperations.FixedTimeEquals(session.Token, supplied))
                        continue;

                    session.LastSeen = now;
                    return true;
                }

                if (!allowRegistration || sessions.Count >= MaximumSessions)
                    return false;

                sessions.Add(new Session(supplied, now));
                retained = true;
                return true;
            }
        }
        finally
        {
            if (!retained)
                CryptographicOperations.ZeroMemory(supplied);
        }
    }

    private sealed class Session(byte[] token, DateTimeOffset lastSeen)
    {
        public byte[] Token { get; } = token;
        public DateTimeOffset LastSeen { get; set; } = lastSeen;
    }
}
