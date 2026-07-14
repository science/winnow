import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

function gitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [svelte(), tailwindcss()],
  // Extension pages load from moz-extension:// — all asset URLs must be relative.
  base: "./",
  server: { host: "0.0.0.0", port: 5173 },
  preview: { host: "0.0.0.0", port: 4173 },
  define: {
    __GIT_HASH__: JSON.stringify(gitHash()),
    __PKG_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: mode !== "production",
    target: "es2022",
    rollupOptions: {
      input: {
        feed: resolve(__dirname, "feed.html"),
        background: resolve(__dirname, "src/background.ts"),
      },
      output: {
        // manifest.json references background.js by name; keep it unhashed
        // and at the dist root. Page assets keep hashed names.
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
}));
