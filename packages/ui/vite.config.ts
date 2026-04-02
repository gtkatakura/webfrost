import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  server: {
    // Proxy API calls to the WebFrost server during development
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  preview: {
    // Proxy API calls to the WebFrost server when running vite preview (E2E)
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
