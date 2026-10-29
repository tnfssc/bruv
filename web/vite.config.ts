import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The built page is committed (users can't build: `pi install` skips dev dependencies), and
// tests/web-assets.test.ts rebuilds it to check `dist/` is fresh, so keep the output the same on every machine.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "dist", emptyOutDir: true, reportCompressedSize: false, target: "es2022" },
});
