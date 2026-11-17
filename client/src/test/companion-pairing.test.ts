import { describe, expect, it, vi } from "vitest";
import { pairCompanionAttempt } from "../lib/companion-pairing";

const attemptId = "attempt-123";
const pairingCredential = {
  pairingToken: "attempt-scoped-jwt",
  expiresInSeconds: 600,
  context: { attemptId },
};

function responseFor(input: RequestInfo | URL, status: number, body: unknown): Response {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return Response.json(body, { status, headers: { "x-test-url": url } });
}

describe("attempt-scoped Companion pairing", () => {
  it("checks the authorized local bridge before requesting an attempt token", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return url.endsWith("/health")
        ? responseFor(input, 200, { status: "ready" })
        : responseFor(input, 200, { status: "connected" });
    });

    await pairCompanionAttempt(attemptId, "https://api.example.test", async requestedAttemptId => {
      expect(calls).toEqual(["GET http://127.0.0.1:43117/health"]);
      expect(requestedAttemptId).toBe(attemptId);
      return pairingCredential;
    }, fetchImpl);

    expect(calls).toEqual([
      "GET http://127.0.0.1:43117/health",
      "POST http://127.0.0.1:43117/pair",
    ]);
    const pairHeaders = new Headers(fetchImpl.mock.calls[1][1]?.headers);
    expect(pairHeaders.get("Authorization")).toMatch(/^Bearer [a-f0-9]{64}$/);
    expect(pairHeaders.get("Content-Type")).toBe("application/json");
    const pairBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
    expect(pairBody).toMatchObject({
      apiUrl: "https://api.example.test",
      pairingToken: pairingCredential.pairingToken,
      consentGranted: true,
    });
  });

  it.each([
    ["missing", { expiresInSeconds: 600, context: { attemptId } }],
    ["expired", { ...pairingCredential, expiresInSeconds: 0 }],
    ["wrong attempt", { ...pairingCredential, context: { attemptId: "another-attempt" } }],
  ])("rejects a %s backend credential before calling /pair", async (_label, credential) => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      responseFor(input, 200, { status: "ready" }));

    await expect(pairCompanionAttempt(
      attemptId,
      "https://api.example.test",
      async () => credential,
      fetchImpl,
    )).rejects.toThrow(/valid Companion credential/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("re-registers the local browser session and retries one unauthorized pair request", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/health")) return responseFor(input, 200, { status: "ready" });
      return calls.filter(call => call.endsWith("/pair")).length === 1
        ? responseFor(input, 401, { error: "Local browser session is not authorized." })
        : responseFor(input, 200, { status: "connected" });
    });

    await pairCompanionAttempt(
      attemptId,
      "https://api.example.test",
      async () => pairingCredential,
      fetchImpl,
    );

    expect(calls.map(call => call.split(" ")[0])).toEqual(["GET", "POST", "GET", "POST"]);
  });

  it("stops after one unauthorized retry and exposes the authentication error", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      responseFor(input, input.toString().endsWith("/health") ? 200 : 401, { status: "ready" }));

    await expect(pairCompanionAttempt(
      attemptId,
      "https://api.example.test",
      async () => pairingCredential,
      fetchImpl,
    )).rejects.toThrow(/did not confirm the connection/i);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("does not request a backend pairing token when local health authorization fails", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      responseFor(input, 401, { error: "Local browser session is not authorized." }));
    const acquireCredential = vi.fn(async () => pairingCredential);

    await expect(pairCompanionAttempt(
      attemptId,
      "https://api.example.test",
      acquireCredential,
      fetchImpl,
    )).rejects.toThrow(/rejected this browser session's authorization/i);
    expect(acquireCredential).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
