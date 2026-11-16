
import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || undefined;

export function resolveCompanionApiOrigin(candidateUrls: Array<string | undefined> = [API_BASE_URL, typeof window !== "undefined" ? window.location.origin : undefined]): string {
  const uniqueCandidates = [...new Set(candidateUrls.filter((value): value is string => Boolean(value)))];
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : undefined;

  for (const candidate of uniqueCandidates) {
    try {
      const url = new URL(candidate, typeof window !== "undefined" ? window.location.origin : "http://localhost");
      if (!url.origin) continue;

      if (currentOrigin && url.origin === currentOrigin) {
        const host = url.hostname.toLowerCase();
        if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return url.origin;
        continue;
      }

      return url.origin;
    } catch {
      // Invalid or relative values are ignored; the caller must provide a real API origin.
    }
  }

  if (currentOrigin && (currentOrigin === "http://localhost" || currentOrigin.startsWith("http://localhost:") || currentOrigin === "http://127.0.0.1" || currentOrigin.startsWith("http://127.0.0.1:") || currentOrigin === "http://[::1]" || currentOrigin.startsWith("http://[::1]:"))) {
    const localMatch = uniqueCandidates.find(candidate => {
      try {
        return new URL(candidate, "http://localhost").origin === currentOrigin;
      } catch {
        return false;
      }
    });
    if (localMatch) return currentOrigin;
  }

  throw new Error("The Companion bridge requires a configured backend API origin. Set VITE_API_URL to the API origin (for example https://api.examguard.example.com) and reload the exam page.");
}

/**
 * Authenticated API client shared by all protected ExamGuard workflows.
 */
export const api = axios.create({
  baseURL: API_BASE_URL,
});

/**
 * Public authentication client intentionally does not attach a stale bearer token.
 * It uses the same backend URL as the authenticated API client.
 */
export const publicApi = axios.create({
  baseURL: API_BASE_URL,
});

if (typeof window !== "undefined") {
  // Older builds persisted bearer tokens for the lifetime of localStorage.
  // Remove that legacy value; current tokens are scoped to this browser tab.
  try {
    window.localStorage.removeItem("sentinel-session");
  } catch {
    // Storage may be disabled by the browser; authenticated requests will fail closed.
  }
}

api.interceptors.request.use((config) => {
  if (typeof window === "undefined") return config;

  try {
    const raw = window.sessionStorage.getItem("sentinel-session");
    const token = raw ? JSON.parse(raw)?.token : undefined;

    if (typeof token === "string" && token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Storage can be unavailable (for example, in restricted/private contexts).
    // A failed read must not turn into a second uncaught storage exception.
    try {
      window.sessionStorage.removeItem("sentinel-session");
    } catch {
      // No token is attached; the protected API will reject the request.
    }
  }

  return config;
});

if (api.interceptors.response?.use) {
  api.interceptors.response.use(
    (response) => response,
    (error) => {
      if (
        axios.isAxiosError(error) &&
        error.response?.status === 401 &&
        typeof window !== "undefined"
      ) {
        window.dispatchEvent(
          new CustomEvent("examguard:session-expired")
        );
      }

      return Promise.reject(error);
    }
  );
}
