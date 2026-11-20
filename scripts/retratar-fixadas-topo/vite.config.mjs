import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"

/** The harness for the pinned bar captures: the real App on a bridge in memory. Loopback only. */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: { port: 5191, strictPort: true, host: "127.0.0.1" },
  logLevel: "warn",
})
