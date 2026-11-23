#!/usr/bin/env node
/** Release-asset smoke test: the published single file is named
 * `quickspot-mcp.js`, so the bundle must run under that name too (the entry
 * check must not depend on the literal `index.js` suffix).
 *
 * Copies dist/index.js to a temp `quickspot-mcp.js`, checks --version and
 * --status, then runs the full stdio e2e against the renamed copy.
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist", "index.js");
const dir = mkdtempSync(join(tmpdir(), "quickspot-bundle-"));
const renamed = join(dir, "quickspot-mcp.js");
copyFileSync(dist, renamed);

let failed = false;
const run = (label, args, env = {}) => {
  const r = spawnSync(process.execPath, [renamed, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.status !== 0) {
    console.error(`FAIL ${label} (exit ${r.status})`);
    if (output) console.error(output);
    failed = true;
    return;
  }
  console.log(`ok: ${label}${output ? ` -> ${output.split("\n")[0]}` : ""}`);
};

try {
  run("renamed bundle --version", ["--version"]);
  run("renamed bundle --status", ["--status"]);
  const e2e = spawnSync(process.execPath, [join(root, "scripts", "e2e-check.mjs")], {
    env: { ...process.env, QUICKSPOT_BUNDLE: renamed },
    stdio: "inherit",
  });
  if (e2e.status !== 0) {
    console.error("FAIL: renamed bundle e2e");
    failed = true;
  } else {
    console.log("ok: renamed bundle stdio e2e");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) process.exitCode = 1;
else console.log("BUNDLE SMOKE PASS");
