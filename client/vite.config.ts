import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const env = loadEnv(mode, repositoryRoot, "VITE_");
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://localhost:4000";
  return {
  envDir: repositoryRoot,
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: Number(env.VITE_PORT || 5173),
    strictPort: true,
    proxy: {
      "/api": apiTarget,
      "/health": apiTarget,
      "/socket.io": { target: apiTarget, ws: true },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    globals: true,
  },
  };
});
