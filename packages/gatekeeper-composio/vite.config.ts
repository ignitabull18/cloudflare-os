import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

function emitAppText(): Plugin {
  return {
    name: "emit-app-text",
    closeBundle() {
      const builtHtml = resolve(packageDirectory, "dist-app", "app", "index.html");
      const output = resolve(packageDirectory, "src", "generated", "app.txt");
      const contents = "<!-- Generated from packages/gatekeeper-composio/app. Do not edit. -->\n" + readFileSync(builtHtml, "utf8");
      if (existsSync(output) && readFileSync(output, "utf8") === contents) return;
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, contents);
    },
  };
}

export default defineConfig({
  plugins: [react(), viteSingleFile(), emitAppText()],
  build: {
    outDir: "dist-app",
    emptyOutDir: true,
    minify: watch ? false : "terser",
    terserOptions: { compress: { passes: 2 }, format: { comments: false } },
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: { input: "app/index.html", output: { entryFileNames: "gatekeeper-composio.js" } },
    watch: watch ? { exclude: ["**/node_modules/**", "**/dist-app/**", "**/.wrangler/**", "**/generated/**"] } : undefined,
  },
});
