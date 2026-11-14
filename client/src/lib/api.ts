
import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || undefined;

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
