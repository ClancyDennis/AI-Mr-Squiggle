import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const mobileHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: mobileHost ?? "127.0.0.1",
    port: 5173,
    strictPort: true,
    hmr: mobileHost
      ? {
          host: mobileHost,
          port: 5173,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
