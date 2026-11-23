/** E2E smoke test (not part of vitest): spawns the bundled server over stdio
 * and runs initialize -> tools/list -> resources -> real tool calls against a
 * fresh temp config. Fails loudly on any protocol or validation error.
 *
 * It always creates its own temp config: running it must never touch the
 * real QuickSpot config, and repeated runs must be independent.
 *
 * Usage: node scripts/e2e-check.mjs
 *        QUICKSPOT_BUNDLE=/tmp/quickspot-mcp.js node scripts/e2e-check.mjs
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const server = process.env.QUICKSPOT_BUNDLE || fileURLToPath(new URL("../dist/index.js", import.meta.url));
const cfgDir = mkdtempSync(join(tmpdir(), "quickspot-e2e-"));
const cfg = join(cfgDir, "quickspot.config.json");
process.env.QUICKSPOT_CONFIG = cfg;

const child = spawn(process.execPath, [server], {
  env: { ...process.env },
  stdio: ["pipe", "pipe", "inherit"],
});

let id = 0;
let buf = "";
const pending = new Map();
child.stdout.on("data", (d) => {
  buf += d.toString();
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    const entry = pending.get(msg.id);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(msg.id);
      entry.resolve(msg);
    }
  }
});

function req(method, params = {}) {
  const thisId = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(thisId);
      reject(new Error(`timeout waiting for ${method}`));
    }, 10_000);
    pending.set(thisId, { resolve, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: thisId, method, params }) + "\n");
  });
}
function notify(method, params = {}) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
  console.log(`ok: ${msg}`);
};
const textOf = (res) => (res.result?.content ?? []).map((c) => c.text ?? "").join("\n");
const fileText = () => readFileSync(cfg, "utf8");

try {
  const init = await req("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "e2e", version: "0.0.0" },
  });
  assert(init.result?.serverInfo?.name === "quickspot", "initialize returns serverInfo.name=quickspot");
  assert(
    typeof init.result?.instructions === "string" && init.result.instructions.includes("Cmd/Ctrl+R"),
    "initialize advertises reload instructions",
  );
  notify("notifications/initialized");

  const tools = await req("tools/list");
  const names = tools.result.tools.map((t) => t.name);
  for (const want of [
    "list-actions",
    "get-config",
    "create-action",
    "update-action",
    "delete-action",
    "move-action",
    "list-groups",
    "create-group",
    "delete-group",
    "validate-config",
  ]) {
    assert(names.includes(want), `tools/list includes ${want}`);
  }
  const create = tools.result.tools.find((t) => t.name === "create-action");
  assert(!(create.inputSchema.required ?? []).includes("value"), "create-action does not require a meaningless value");
  assert(create.annotations?.openWorldHint === false, "create-action is annotated as local-only");

  const resources = await req("resources/list");
  assert(
    resources.result.resources.some((r) => r.uri === "quickspot://config"),
    "resources/list includes quickspot://config",
  );

  const call = (name, args) => req("tools/call", { name, arguments: args });

  const list0 = await call("list-actions", {});
  assert(textOf(list0).includes("QuickSpot"), "list-actions shows defaults on a fresh temp config");

  const resource = await req("resources/read", { uri: "quickspot://config" });
  const resourceConfig = JSON.parse(resource.result.contents[0].text);
  assert(Array.isArray(resourceConfig.actions) && resourceConfig.actions.length === 3, "resource returns the parsed config");

  const dup = await call("create-action", { name: "QuickSpot", kind: "url", value: "https://x.dev" });
  assert(dup.result.isError, "create-action rejects duplicate names");

  const created = await call("create-action", { name: "Deploy", kind: "command", value: "make deploy" });
  assert(textOf(created).includes("created"), "create-action creates command");
  assert(textOf(created).includes("Cmd/Ctrl+R"), "mutation result reminds about reload");

  // Regression: a sequence call must not need a meaningless `value`.
  const seq = await call("create-action", {
    name: "Morning",
    kind: "sequence",
    steps: [
      { kind: "folder", value: "/tmp" },
      { kind: "url", value: "https://example.com" },
    ],
  });
  assert(textOf(seq).includes("created"), "create-action creates sequence without value");

  const six = Array.from({ length: 6 }, (_, i) => ({ kind: "url", value: `https://e.dev/${i}` }));
  const tooMany = await call("create-action", { name: "TooMany", kind: "sequence", steps: six });
  assert(tooMany.result.isError, "create-action rejects more than 5 steps");

  const badGroup = await call("create-action", { name: "G", kind: "url", value: "https://g.dev", group: "nope" });
  assert(badGroup.result.isError, "create-action rejects unknown group");

  const blankGroup = await call("create-group", { name: "   ", color: "#5e9eff" });
  assert(blankGroup.result.isError, "create-group rejects a blank name instead of silently doing nothing");

  const grp = await call("create-group", { name: "Work", color: "#5e9eff" });
  assert(textOf(grp).includes('id "work"'), "create-group slugs id from name");

  const upd = await call("update-action", { ref: "Deploy", group: "work" });
  assert(textOf(upd).includes("updated"), "update-action assigns group");
  const ungroup = await call("update-action", { ref: "Deploy", group: null });
  assert(textOf(ungroup).includes("updated"), "update-action clears group with null");
  const updMany = await call("update-action", { ref: "Morning", steps: six });
  assert(updMany.result.isError, "update-action rejects more than 5 steps");

  const moved = await call("move-action", { ref: "Deploy", to: 999 });
  assert(textOf(moved).includes("position"), "move-action clamps the destination");

  const got = await call("get-config", {});
  assert(textOf(got).includes("Path:"), "get-config returns the resolved path");
  const gotRaw = await call("get-config", { raw: true });
  assert(textOf(gotRaw).includes('"actions"'), "get-config raw returns the exact file text");

  const valid = await call("validate-config", {});
  assert(textOf(valid).includes("Valid"), "validate-config reports valid");

  const beforeNull = fileText();
  writeFileSync(cfg, "null");
  const nullValidation = await call("validate-config", {});
  assert(textOf(nullValidation).includes("INVALID"), "validate-config reports JSON null as invalid");
  assert(!textOf(nullValidation).includes("Cannot read properties of null"), "validate-config does not leak a TypeError");
  writeFileSync(cfg, beforeNull);

  const del = await call("delete-action", { ref: "Deploy" });
  assert(textOf(del).includes("deleted"), "delete-action removes");
  const missing = await call("delete-action", { ref: "NoExiste" });
  assert(missing.result.isError, "delete-action errors on unknown ref");

  // Backend-compat check: the file the MCP wrote must parse with the same rules.
  assert(existsSync(cfg), "config file was written");
  const raw = JSON.parse(fileText());
  assert(Array.isArray(raw.actions), "written file keeps actions array");
  assert(
    raw.actions.every((a) => typeof a.name === "string" && typeof a.kind === "string"),
    "every action has name/kind",
  );
  const sequence = raw.actions.find((a) => a.kind === "sequence");
  assert(Array.isArray(sequence?.steps) && sequence.steps.length > 0, "sequence keeps its steps");
  assert(
    raw.actions.filter((a) => a.kind !== "sequence").every((a) => a.steps === undefined),
    "non-sequence actions never carry steps",
  );

  console.log("E2E PASS");
  rmSync(cfgDir, { recursive: true, force: true });
} catch (e) {
  console.error(`E2E FAIL: ${e instanceof Error ? e.message : String(e)}`);
  console.error(`Config kept for inspection: ${cfg}`);
  process.exitCode = 1;
} finally {
  child.kill();
}
