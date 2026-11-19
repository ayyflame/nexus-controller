import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and must not watch the Rust sources.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // WebView2 (Chromium) is the only target on Windows 11.
    target: "chrome120",
    sourcemap: false,
    // The 3D controller view (three.js) is one lazily loaded chunk of ~1 MB
    // (~270 kB gzipped); it is loaded only when a 3D view is first shown.
    chunkSizeWarningLimit: 1100,
  },
});
