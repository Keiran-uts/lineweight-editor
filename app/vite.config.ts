import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The bridge (Node/Express) runs on 8787. The Vite dev server proxies all
// /api calls to it so the browser only ever talks to one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
