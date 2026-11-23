/** Pack dist/index.js + manifest into quickspot.mcpb (a zip) for one-click
 * install in Claude Desktop (Settings -> Extensions -> Install Extension).
 * Prefers the official `@anthropic-ai/mcpb` CLI when available; otherwise
 * falls back to the platform `zip`/`tar` tool. No extra npm dependency.
 *
 * The staging directory lives in the OS temp dir, never in dist/: keeping it
 * out of the package means `npm pack` cannot accidentally ship a second copy
 * of the 890 KB bundle.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Run a CLI, going through cmd.exe on Windows because npx is a .cmd shim. */
function run(cmd, args, opts) {
  if (platform() === "win32") {
    const quote = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const line = [cmd, ...args].map(quote).join(" ");
    return spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", line], opts);
  }
  return spawnSync(cmd, args, opts);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist", "index.js");
const manifestSrc = join(root, "mcpb", "manifest.json");
const out = process.env.MCPB_OUT || join(root, "quickspot.mcpb");

if (!existsSync(dist)) {
  console.error("missing dist/index.js — run `npm run build` first");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestSrc, "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (manifest.version !== pkg.version) {
  console.error(`manifest version ${manifest.version} != package version ${pkg.version}`);
  process.exit(1);
}

// Stage a clean bundle dir: server/index.js (self-contained) + manifest.json.
const stage = mkdtempSync(join(tmpdir(), "quickspot-mcpb-"));
mkdirSync(join(stage, "server"), { recursive: true });
copyFileSync(dist, join(stage, "server", "index.js"));
writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

let packed = false;
let usedFallback = false;
try {
  const mcpb = run("npx", ["-y", "@anthropic-ai/mcpb", "pack", stage, out], {
    cwd: root,
    stdio: "inherit",
  });
  if (mcpb.status === 0) {
    packed = true;
  } else {
    console.log("mcpb CLI unavailable, trying platform zip ...");
    const zip = run("zip", ["-qr", out, "server/index.js", "manifest.json"], {
      cwd: stage,
      stdio: "inherit",
    });
    packed = zip.status === 0;
    usedFallback = packed;
  }
} finally {
  rmSync(stage, { recursive: true, force: true });
}

if (packed) {
  console.log(`packed ${out}${usedFallback ? " (plain zip fallback)" : ""}`);
} else {
  console.error("could not pack .mcpb (need npx @anthropic-ai/mcpb or the `zip` tool)");
  process.exitCode = 1;
}
