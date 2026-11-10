import { beforeEach, describe, expect, it } from "vitest";
import { api, publicApi } from "../lib/api";

// Uses axios' public `defaults.adapter` so no network is involved. Runs under Vitest/jsdom (real axios) or the sandbox stand-in.
type Cfg = { headers: Record<string, string> };
let seen: Cfg[] = [];
const ok = async (config: Cfg) => { seen.push(config); return { data: {}, status: 200, statusText: "OK", headers: {}, config }; };
const failing = (status?: number) => async (config: Cfg) => { seen.push(config); throw Object.assign(new Error(status ? `http ${status}` : "Network Error"), { isAxiosError: true, config, response: status ? { status, data: {}, headers: {}, config, statusText: "" } : undefined }); };
const expired: string[] = [];
const onExpired = () => expired.push("expired");

beforeEach(() => { seen = []; expired.length = 0; window.sessionStorage.clear(); window.removeEventListener("examguard:session-expired", onExpired); window.addEventListener("examguard:session-expired", onExpired); });

describe("authenticated API client", () => {
  it("attaches the bearer token from this tab's session", async () => {
    window.sessionStorage.setItem("sentinel-session", JSON.stringify({ token: "abc.def.ghi" })); (api.defaults as any).adapter = ok;
    await api.get("/api/x"); expect(seen[0].headers.Authorization).toBe("Bearer abc.def.ghi");
  });
  it("sends no Authorization header without a session", async () => { (api.defaults as any).adapter = ok; await api.get("/api/x"); expect(seen[0].headers.Authorization).toBeUndefined(); });
  it("survives a corrupted stored session: request still goes out unauthenticated and the bad value is removed", async () => {
    window.sessionStorage.setItem("sentinel-session", "{not json"); (api.defaults as any).adapter = ok;
    await api.get("/api/x"); expect(seen[0].headers.Authorization).toBeUndefined(); expect(window.sessionStorage.getItem("sentinel-session")).toBeNull();
  });
  it("does not attach an empty or non-string token", async () => {
    (api.defaults as any).adapter = ok;
    for (const bad of [{ token: "" }, { token: 123 }, {}]) { window.sessionStorage.setItem("sentinel-session", JSON.stringify(bad)); await api.get("/api/x"); }
    expect(seen.every((c) => c.headers.Authorization === undefined)).toBe(true);
  });
});

describe("authentication failures", () => {
  it("a 401 announces session expiry exactly once and still rejects with the original error", async () => {
    (api.defaults as any).adapter = failing(401);
    let caught: any; try { await api.get("/api/x"); } catch (e) { caught = e; }
    expect(caught.response.status).toBe(401); expect(expired).toHaveLength(1);
  });
  it("other failures do NOT log the user out", async () => {
    for (const status of [400, 403, 404, 409, 429, 500, undefined]) { (api.defaults as any).adapter = failing(status); try { await api.get("/api/x"); } catch { /* expected */ } }
    expect(expired).toHaveLength(0);
  });
  it("successful responses pass through untouched", async () => { (api.defaults as any).adapter = ok; const r = await api.get("/api/x"); expect(r.status).toBe(200); expect(expired).toHaveLength(0); });
});

describe("public API client", () => {
  it("never attaches a stale bearer token (login, registration and password reset)", async () => {
    window.sessionStorage.setItem("sentinel-session", JSON.stringify({ token: "stale.token.value" })); (publicApi.defaults as any).adapter = ok;
    await publicApi.post("/api/auth/login", {}); expect(seen[0].headers.Authorization).toBeUndefined();
  });
  it("a 401 from a public call (wrong password) does not trigger the session-expired redirect", async () => {
    (publicApi.defaults as any).adapter = failing(401); try { await publicApi.post("/api/auth/login", {}); } catch { /* expected */ } expect(expired).toHaveLength(0);
  });
});
