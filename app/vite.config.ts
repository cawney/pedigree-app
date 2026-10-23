import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the app calls the catalog server through /api, so phones and
// tablets on the same network can use the dev server without extra setup.
const apiTarget = process.env.PEDIGREE_API ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
    },
  },
});
