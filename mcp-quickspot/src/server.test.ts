import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import { createServer } from "./index.js";

let dir: string;
let cfg: string;
let client: Client;
let server: McpServer;

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { type: string; text?: string }[])
    .map((c) => c.text ?? "")
    .join("\n");
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "qsmcp-server-"));
  cfg = join(dir, "quickspot.config.json");
  process.env.QUICKSPOT_CONFIG = cfg;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  server = createServer();
  await server.connect(serverTransport);
  client = new Client({ name: "vitest", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  await server.close();
  delete process.env.QUICKSPOT_CONFIG;
  rmSync(dir, { recursive: true, force: true });
});

describe("MCP tools", () => {
  it("lists every tool and does not require a meaningless value for sequences", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
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
      ]),
    );
    const create = tools.find((t) => t.name === "create-action")!;
    expect(create.inputSchema.required ?? []).not.toContain("value");
    expect(create.annotations?.openWorldHint).toBe(false);
  });

  it("creates a sequence without passing value", async () => {
    const result = await client.callTool({
      name: "create-action",
      arguments: {
        name: "Morning",
        kind: "sequence",
        steps: [
          { kind: "folder", value: "/tmp" },
          { kind: "url", value: "https://example.com" },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("created");
    const raw = JSON.parse(readFileSync(cfg, "utf8"));
    const sequence = raw.actions.find((a: { name: string }) => a.name === "Morning");
    expect(sequence.kind).toBe("sequence");
    expect(sequence.steps).toHaveLength(2);
  });

  it("rejects a blank group name instead of reporting a silent no-op", async () => {
    const result = await client.callTool({
      name: "create-group",
      arguments: { name: "   ", color: "#5e9eff" },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/name/i);
  });

  it("reports JSON null as invalid instead of leaking a TypeError", async () => {
    writeFileSync(cfg, "null");
    const result = await client.callTool({ name: "validate-config", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("INVALID");
    expect(text(result)).not.toContain("Cannot read properties of null");
  });

  it("returns the exact file text from get-config raw", async () => {
    const source = '{"actions":[],"theme":"deep"}\n';
    writeFileSync(cfg, source);
    const parsed = await client.callTool({ name: "get-config", arguments: {} });
    expect(text(parsed)).toContain('"theme": "deep"');
    const raw = await client.callTool({ name: "get-config", arguments: { raw: true } });
    expect(text(raw)).toContain(source.trim());
    expect(text(raw)).toContain("Valid: true");
  });

  it("preserves a browser field on a non-URL action during an unrelated update", async () => {
    writeFileSync(
      cfg,
      JSON.stringify({
        actions: [
          { name: "Cmd", kind: "command", value: "echo hi", browser: "/bin/x", hint: "h" },
        ],
      }),
    );
    const result = await client.callTool({
      name: "update-action",
      arguments: { ref: "Cmd", hint: "h2" },
    });
    expect(result.isError).toBeFalsy();
    const raw = JSON.parse(readFileSync(cfg, "utf8"));
    expect(raw.actions[0].browser).toBe("/bin/x");
    expect(raw.actions[0].hint).toBe("h2");
  });

  it("exposes the config as a resource", async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("quickspot://config");
    const read = await client.readResource({ uri: "quickspot://config" });
    const payload = JSON.parse((read.contents[0] as { text: string }).text);
    expect(payload.actions).toHaveLength(3);
  });

  it("warns when listing a corrupt config instead of silently showing defaults", async () => {
    writeFileSync(cfg, "{ bad");
    const result = await client.callTool({ name: "list-actions", arguments: {} });
    expect(text(result)).toContain("WARNING");
    expect(text(result)).toContain("could not be parsed");
  });

  it("warns and keeps a .bak when a mutation rebuilds a corrupt config", async () => {
    writeFileSync(cfg, "{ not json");
    const result = await client.callTool({
      name: "create-action",
      arguments: { name: "Recovered", kind: "url", value: "https://r.dev" },
    });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("WARNING");
    expect(text(result)).toContain("created");
    const raw = JSON.parse(readFileSync(cfg, "utf8"));
    expect(raw.actions.some((a: { name: string }) => a.name === "Recovered")).toBe(true);
    expect(readFileSync(`${cfg}.bak`, "utf8")).toBe("{ not json");
  });

  it("rejects more than five steps", async () => {
    const steps = Array.from({ length: 6 }, (_, i) => ({
      kind: "url",
      value: `https://e.dev/${i}`,
    }));
    const result = await client.callTool({
      name: "create-action",
      arguments: { name: "TooMany", kind: "sequence", steps },
    });
    expect(result.isError).toBe(true);
  });
});
