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
Assert(!sessions.Authorize(mismatchedSessionToken, allowRegistration: false, now: now.AddMinutes(2)), "A token registered to a different browser session must not authorize protected requests.");
Assert(!sessions.Authorize(tokenA, allowRegistration: false, now: now.AddMinutes(31)), "An idle-expired token must be rejected on protected requests.");
Assert(sessions.Authorize(tokenA, allowRegistration: true, now: now.AddMinutes(31)), "A health check may re-register its browser token after idle expiry.");
Assert(sessions.Authorize(tokenA, allowRegistration: false, now: now.AddMinutes(32)), "A re-registered token must authorize protected requests.");

Console.WriteLine("PASS: missing, malformed, valid, second-tab, mismatched-session, and idle-expired browser session tokens.");

static void Assert(bool condition, string message)
{
    if (!condition)
        throw new InvalidOperationException(message);
}
