/** Bundle src/index.ts (incl. @modelcontextprotocol/server + zod) into a
 * single self-contained dist/index.js. One file = one Release asset. */
import { buildSync } from "esbuild";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../dist/index.js", import.meta.url));
mkdirSync(fileURLToPath(new URL("../dist", import.meta.url)), { recursive: true });

buildSync({
  entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: out,
  logLevel: "info",
});

// esbuild `banner` would place the shebang after its prelude (line 2),
// which Node rejects — prepend it here so it stays on line 1.
const body = readFileSync(out, "utf8");
if (!body.startsWith("#!")) {
  writeFileSync(out, "#!/usr/bin/env node\n" + body);
}
try {
  chmodSync(out, 0o755);
} catch {
  // non-fatal (Windows)
}
console.log("built dist/index.js");
