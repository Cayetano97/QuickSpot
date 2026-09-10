/** Bundle src/index.ts (incl. @modelcontextprotocol/server + zod) into a
 * single self-contained dist/index.js. One file = one Release asset. */
import { buildSync } from "esbuild";
import { mkdirSync } from "node:fs";

import { chmodSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync(new URL("../dist", import.meta.url), { recursive: true });

const out = new URL("../dist/index.js", import.meta.url);

buildSync({
  entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: out.pathname,
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
