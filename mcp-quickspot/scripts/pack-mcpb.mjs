/** Pack dist/index.js + manifest into quickspot.mcpb (a zip) for one-click
 * install in Claude Desktop (Settings -> Extensions -> Install Extension).
 * Prefers the official `@anthropic-ai/mcpb` CLI when available; otherwise
 * falls back to the platform `zip`/`tar` tool. No extra npm dependency.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const dist = root + "/dist/index.js";
const manifestSrc = root + "/mcpb/manifest.json";
const out = process.env.MCPB_OUT || root + "/quickspot.mcpb";

if (!existsSync(dist)) {
  console.error("missing dist/index.js — run `npm run build` first");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestSrc, "utf8"));

// Stage a clean bundle dir: server/index.js (self-contained) + manifest.json.
const stage = root + "/dist/mcpb-stage";
mkdirSync(stage + "/server", { recursive: true });
copyFileSync(dist, stage + "/server/index.js");
writeFileSync(stage + "/manifest.json", JSON.stringify(manifest, null, 2) + "\n");

const mcpb = spawnSync("npx", ["-y", "@anthropic-ai/mcpb", "pack", stage, out], {
  cwd: root,
  stdio: "inherit",
});
if (mcpb.status === 0) {
  console.log(`packed ${out}`);
  process.exit(0);
}
console.log("mcpb CLI unavailable, trying platform zip ...");
const zip = spawnSync("zip", ["-qr", out, "server/index.js", "manifest.json"], { cwd: stage, stdio: "inherit" });
if (zip.status === 0) {
  console.log(`packed ${out} (plain zip fallback)`);
  process.exit(0);
}
console.error("could not pack .mcpb (need npx @anthropic-ai/mcpb or the `zip` tool)");
process.exit(1);
