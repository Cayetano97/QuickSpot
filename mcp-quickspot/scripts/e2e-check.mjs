/** E2E smoke test (not part of vitest): spawns the bundled server over stdio
 * and runs initialize -> tools/list -> real tool calls against an isolated
 * QUICKSPOT_CONFIG. Fails loudly on any protocol or validation error.
 * Usage: QUICKSPOT_CONFIG=/tmp/x.json node scripts/e2e-check.mjs */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const server = new URL("../dist/index.js", import.meta.url).pathname;
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
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  }
});

function req(method, params = {}) {
  const thisId = ++id;
  return new Promise((resolve) => {
    pending.set(thisId, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: thisId, method, params }) + "\n");
  });
}
function notify(method, params = {}) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`E2E FAIL: ${msg}`);
    child.kill();
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
};

const init = await req("initialize", {
  protocolVersion: "2025-11-25",
  capabilities: {},
  clientInfo: { name: "e2e", version: "0.0.0" },
});
assert(init.result?.serverInfo?.name === "quickspot", "initialize returns serverInfo.name=quickspot");
notify("notifications/initialized");

const tools = await req("tools/list");
const names = tools.result.tools.map((t) => t.name);
for (const want of ["list-actions", "get-config", "create-action", "update-action", "delete-action", "move-action", "list-groups", "create-group", "delete-group", "validate-config"]) {
  assert(names.includes(want), `tools/list includes ${want}`);
}

const call = (name, args) => req("tools/call", { name, arguments: args });
const textOf = (res) => res.result.content.map((c) => c.text).join("\n");

const list0 = await call("list-actions", {});
assert(textOf(list0).includes("QuickSpot"), "list-actions shows defaults on fresh temp config");

const dup = await call("create-action", { name: "QuickSpot", kind: "url", value: "https://x.dev" });
assert(dup.result.isError, "create-action rejects duplicate names");

const created = await call("create-action", { name: "Deploy", kind: "command", value: "make deploy" });
assert(textOf(created).includes("created"), "create-action creates command");
assert(textOf(created).includes("Cmd/Ctrl+R"), "mutation result reminds about reload");

const seq = await call("create-action", {
  name: "Morning",
  kind: "sequence",
  value: "",
  steps: [
    { kind: "folder", value: "/tmp" },
    { kind: "url", value: "https://example.com" },
  ],
});
assert(textOf(seq).includes("created"), "create-action creates sequence");

const badGroup = await call("create-action", { name: "G", kind: "url", value: "https://g.dev", group: "nope" });
assert(badGroup.result.isError, "create-action rejects unknown group");

const grp = await call("create-group", { name: "Work", color: "#5e9eff" });
assert(textOf(grp).includes('id "work"'), "create-group slugs id from name");

const upd = await call("update-action", { ref: "Deploy", group: "work" });
assert(textOf(upd).includes("updated"), "update-action assigns group");

const moved = await call("move-action", { ref: "Deploy", to: 0 });
assert(textOf(moved).includes("position 0"), "move-action reorders");

const valid = await call("validate-config", {});
assert(textOf(valid).includes("Valid"), "validate-config reports valid");

const del = await call("delete-action", { ref: "Deploy" });
assert(textOf(del).includes("deleted"), "delete-action removes");

const missing = await call("delete-action", { ref: "NoExiste" });
assert(missing.result.isError, "delete-action errors on unknown ref");

// Backend-compat check: the file the MCP wrote must parse with the same rules.
const cfgPath = process.env.QUICKSPOT_CONFIG;
assert(!!cfgPath && existsSync(cfgPath), "config file was written");
const raw = JSON.parse(readFileSync(cfgPath, "utf8"));
assert(Array.isArray(raw.actions), "written file keeps actions array");
assert(raw.actions.every((a) => typeof a.name === "string" && typeof a.kind === "string"), "every action has name/kind");

child.kill();
console.log("E2E PASS");
