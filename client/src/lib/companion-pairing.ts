import { checkCompanionBridge, companionBridgeAuthorization } from "./exam-readiness";

type PairingCredential = {
  pairingToken: string;
  expiresInSeconds: number;
  context: { attemptId: string };
};

function isPairingCredential(value: unknown, attemptId: string): value is PairingCredential {
  if (typeof value !== "object" || value === null) return false;
  const credential = value as Record<string, unknown>;
  const context = credential.context;
  return typeof credential.pairingToken === "string" &&
    credential.pairingToken.length > 0 &&
    typeof credential.expiresInSeconds === "number" &&
    Number.isFinite(credential.expiresInSeconds) &&
    credential.expiresInSeconds > 0 &&
    typeof context === "object" &&
    context !== null &&
    (context as Record<string, unknown>).attemptId === attemptId;
}

export async function pairCompanionAttempt(
  attemptId: string,
  apiUrl: string,
  acquireCredential: (attemptId: string) => Promise<unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const ensureLocalBridgeReady = async () => {
    const health = await checkCompanionBridge(fetchImpl);
    if (health.status !== "ready") throw new Error(health.explanation);
  };

  await ensureLocalBridgeReady();
  const credential = await acquireCredential(attemptId);
  if (!isPairingCredential(credential, attemptId)) {
    throw new Error("The server did not issue a valid Companion credential for this active attempt.");
  }

  const requestPairing = () => fetchImpl("http://127.0.0.1:43117/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...companionBridgeAuthorization() },
    cache: "no-store",
    body: JSON.stringify({ apiUrl, pairingToken: credential.pairingToken, consentGranted: true }),
  });

  let response = await requestPairing();
  if (response.status === 401) {
    await ensureLocalBridgeReady();
    response = await requestPairing();
  }

  const result = await response.json().catch(() => ({})) as { status?: unknown; error?: unknown };
  if (!response.ok || result.status !== "connected") {
    throw new Error(typeof result.error === "string" ? result.error : "The Windows Companion did not confirm the connection.");
  }
}
