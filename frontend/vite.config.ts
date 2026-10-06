import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Las llamadas a /api se redirigen al backend, así el navegador no necesita CORS.
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
});
