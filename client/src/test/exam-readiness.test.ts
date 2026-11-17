import { describe, expect, it, vi } from "vitest";
import { resolveCompanionApiOrigin } from "../lib/api";
import {
  browserCompatibility,
  cameraStreamHasLiveTrack,
  cameraStreamIsActive,
  checkCompanionBridge,
  fullDisplayStreamIsActive,
  microphoneStreamIsActive,
  requestCameraStream,
  requestFullDisplayStream,
  requestMicrophoneStream,
} from "../lib/exam-readiness";

class FakeTrack extends EventTarget {
  enabled = true;
  muted = false;
  readyState: MediaStreamTrackState = "live";

  constructor(readonly kind: "audio" | "video", public displaySurface?: string) {
    super();
  }

  getSettings(): MediaTrackSettings {
    return { displaySurface: this.displaySurface } as MediaTrackSettings;
  }

  stop() {
    this.readyState = "ended";
  }
}

function fakeStream(...tracks: FakeTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter(track => track.kind === "video"),
    getAudioTracks: () => tracks.filter(track => track.kind === "audio"),
  } as unknown as MediaStream;
}

describe("examination media readiness", () => {
  it("reports camera permission denial instead of readiness", async () => {
    const devices = { getUserMedia: vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError")) };
    await expect(requestCameraStream(devices)).rejects.toMatchObject({
      name: "MediaCheckError",
      status: "failed",
      remediation: expect.stringMatching(/permission/i),
    });
  });

  it("reports missing camera and microphone devices as unavailable", async () => {
    const cameraDevices = { getUserMedia: vi.fn().mockRejectedValue(new DOMException("Missing", "NotFoundError")) };
    const microphoneDevices = { getUserMedia: vi.fn().mockRejectedValue(new DOMException("Missing", "NotFoundError")) };
    await expect(requestCameraStream(cameraDevices)).rejects.toMatchObject({ status: "unavailable" });
    await expect(requestMicrophoneStream(microphoneDevices)).rejects.toMatchObject({ status: "unavailable" });
  });

  it("accepts only live camera and microphone tracks", async () => {
    const camera = new FakeTrack("video");
    const microphone = new FakeTrack("audio");
    const cameraStream = fakeStream(camera);
    const microphoneStream = fakeStream(microphone);
    expect(await requestCameraStream({ getUserMedia: vi.fn().mockResolvedValue(cameraStream) })).toBe(cameraStream);
    expect(await requestMicrophoneStream({ getUserMedia: vi.fn().mockResolvedValue(microphoneStream) })).toBe(microphoneStream);
    expect(cameraStreamIsActive(cameraStream)).toBe(true);
    expect(cameraStreamHasLiveTrack(cameraStream)).toBe(true);
    expect(microphoneStreamIsActive(microphoneStream)).toBe(true);
    camera.muted = true;
    expect(cameraStreamIsActive(cameraStream)).toBe(false);
    expect(cameraStreamHasLiveTrack(cameraStream)).toBe(true);
    camera.muted = false;
    camera.enabled = false;
    expect(cameraStreamHasLiveTrack(cameraStream)).toBe(false);
    camera.enabled = true;
    camera.stop();
    microphone.stop();
    expect(cameraStreamIsActive(cameraStream)).toBe(false);
    expect(microphoneStreamIsActive(microphoneStream)).toBe(false);
  });

  it("reports denied screen-sharing permission", async () => {
    const devices = { getDisplayMedia: vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError")) };
    await expect(requestFullDisplayStream(devices)).rejects.toMatchObject({
      status: "failed",
      remediation: expect.stringMatching(/allow/i),
    });
  });

  it("rejects a shared window and detects when the monitor track ends", async () => {
    const windowTrack = new FakeTrack("video", "window");
    const windowStream = fakeStream(windowTrack);
    const windowDevices = { getDisplayMedia: vi.fn().mockResolvedValue(windowStream) };
    await expect(requestFullDisplayStream(windowDevices)).rejects.toMatchObject({ status: "failed" });
    expect(windowTrack.readyState).toBe("ended");

    const monitorTrack = new FakeTrack("video", "monitor");
    const monitorStream = fakeStream(monitorTrack);
    const monitorDevices = { getDisplayMedia: vi.fn().mockResolvedValue(monitorStream) };
    expect(await requestFullDisplayStream(monitorDevices)).toBe(monitorStream);
    expect(fullDisplayStreamIsActive(monitorStream)).toBe(true);
    monitorTrack.displaySurface = "window";
    expect(fullDisplayStreamIsActive(monitorStream)).toBe(false);
    monitorTrack.displaySurface = "monitor";
    monitorTrack.readyState = "ended";
    expect(fullDisplayStreamIsActive(monitorStream)).toBe(false);
  });

  it("requires a secure recognized browser with both media APIs", () => {
    expect(browserCompatibility("Mozilla/5.0 Chrome/130.0", true, true, true).status).toBe("ready");
    expect(browserCompatibility("Mozilla/5.0 Chrome/130.0", false, true, true).status).toBe("failed");
    expect(browserCompatibility("unknown", true, true, true).status).toBe("unavailable");
  });

  it("reports a missing or disconnected Companion bridge as unavailable", async () => {
    const disconnected = await checkCompanionBridge(async () => new Response(null, { status: 503 }));
    expect(disconnected.status).toBe("unavailable");
    const missing = await checkCompanionBridge(async () => { throw new Error("offline"); });
    expect(missing.status).toBe("unavailable");
    expect(missing.remediation).toMatch(/install and register/i);
  });

  it("replaces a saved bridge token that does not match the Companion's required format", async () => {
    const key = "examguard:companion-bridge-token";
    try {
      for (const malformed of ["a".repeat(32), "g".repeat(64)]) {
        window.sessionStorage.setItem(key, malformed);
        vi.resetModules();
        const { getCompanionBridgeToken, companionBridgeAuthorization } = await import("../lib/exam-readiness");
        const token = getCompanionBridgeToken();

        expect(token).toMatch(/^[0-9a-f]{64}$/i);
        expect(token).not.toBe(malformed);
        expect(window.sessionStorage.getItem(key)).toBe(token);
        expect(companionBridgeAuthorization().Authorization).toBe(`Bearer ${token}`);
      }
      const valid = "ab".repeat(32);
      window.sessionStorage.setItem(key, valid);
      vi.resetModules();
      const { getCompanionBridgeToken: getValidToken } = await import("../lib/exam-readiness");
      expect(getValidToken()).toBe(valid);
    } finally {
      window.sessionStorage.removeItem(key);
    }
  });

  it("does not claim the Companion is ready unless its local bridge reports ready", async () => {
    const response = await checkCompanionBridge(async () => Response.json({ status: "ready" }));
    expect(response.status).toBe("ready");
  });

  it("authenticates health checks with a random local browser session token", async () => {
    let requestHeaders: HeadersInit | undefined;
    const response = await checkCompanionBridge(async (_input, init) => {
      requestHeaders = init?.headers;
      return Response.json({ status: "ready" });
    });
    expect(response.status).toBe("ready");
    const authorization = new Headers(requestHeaders).get("Authorization");
    expect(authorization).toMatch(/^Bearer [a-f0-9]{64}$/);
  });

  it("uses the backend API origin for Companion pairing instead of the frontend origin", () => {
    expect(resolveCompanionApiOrigin(["https://api.examguard.example.com/api", "https://examguard-sooty.vercel.app"]))
      .toBe("https://api.examguard.example.com");
    expect(() => resolveCompanionApiOrigin([])).toThrow(/configured backend API origin/i);
  });

  it("reports rejected local bridge authorization and permission failures for user recovery", async () => {
    const fetchUnauthorized = vi.fn(async () => new Response(null, { status: 401 }));
    const unauthorized = await checkCompanionBridge(fetchUnauthorized);
    expect(unauthorized.status).toBe("unavailable");
    expect(unauthorized.explanation).toMatch(/rejected this browser session's authorization/i);
    expect(unauthorized.remediation).toMatch(/restart the Companion/i);
    expect(fetchUnauthorized).toHaveBeenCalledTimes(1);
    const denied = await checkCompanionBridge(async () => { throw new TypeError("Failed to fetch"); });
    expect(denied.status).toBe("unavailable");
    expect(denied.explanation).toMatch(/Local network access permission/i);
    expect(denied.remediation).toMatch(/site settings/i);
  });
});
