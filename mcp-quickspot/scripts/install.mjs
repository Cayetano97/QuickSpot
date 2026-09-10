#!/usr/bin/env node
/** From-source installer for humans AND agents. Opt-in by design: with no
 * action flags the server ASKS before installing ([y/N] on a TTY) and
 * refuses on a non-interactive shell unless --yes is given. Nothing is ever
 * installed silently.
 *
 * 1. Builds dist/index.js when missing/stale (needs devDeps: `npm ci` first
 *    when cloning the repo; skips the build for a Release download).
 * 2. Delegates to `dist/index.js` (the single source of truth).
 *
 * Usage (identical on macOS / Windows / Linux):
 *   node mcp-quickspot/scripts/install.mjs                  # asks first, installs only on "y"
 *   node mcp-quickspot/scripts/install.mjs --yes             # agents / CI: install without asking
 *   node mcp-quickspot/scripts/install.mjs --install --clients opencode,codex
 *   node mcp-quickspot/scripts/install.mjs --status
 */
import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const dist = new URL("../dist/index.js", import.meta.url);
const args = process.argv.slice(2);

function newestMtimeMs(pathUrl) {
  try {
    return statSync(pathUrl).mtimeMs;
  } catch {
    return 0;
  }
}

let needBuild = !existsSync(dist);
if (!needBuild) {
  // Rebuild when any src file is newer than the bundle (cheap staleness check).
  const { readdirSync } = await import("node:fs");
  const srcDir = new URL("../src", import.meta.url);
  const distMs = newestMtimeMs(dist);
  for (const f of readdirSync(srcDir)) {
    if (f.endsWith(".ts") && newestMtimeMs(new URL(`../src/${f}`, import.meta.url)) > distMs) {
      needBuild = true;
      break;
    }
  }
}

if (needBuild) {
  console.log("[quickspot-mcp] building dist/index.js ...");
  const build = spawnSync("node", [new URL("./build.mjs", import.meta.url).pathname], {
    cwd: root.pathname,
    stdio: "inherit",
  });
  if (build.status !== 0) {
    console.error("[quickspot-mcp] build failed. From a git clone run `npm ci` inside mcp-quickspot/ first.");
    process.exit(build.status ?? 1);
  }
}

const passthrough = args;
const res = spawnSync(process.execPath, [dist.pathname, ...passthrough], { stdio: "inherit" });
process.exit(res.status ?? 0);
