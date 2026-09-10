import { describe, expect, it } from "vitest";
import {
  buildEntry,
  clientConfigFile,
  codexConfigFile,
  codexEntry,
  configKeyFor,
  currentOsPaths,
  mergeConfig,
  mergeOpenCode,
  opencodeConfigFile,
  openCodeEntry,
  removeCodexToml,
  removeFromConfig,
  removeOpenCode,
  stableServerPath,
  upsertCodexToml,
} from "./install.js";

describe("client config paths", () => {
  it("resolves per-OS desktop config locations", () => {
    const mac = { ...currentOsPaths(), home: "/Users/me", plat: "darwin" as const };
    expect(clientConfigFile("claude-desktop", mac)).toContain("Library/Application Support/Claude");
    const win = { ...currentOsPaths(), home: "C:\\U", plat: "win32" as const, appdata: "C:\\U\\AppData\\Roaming" };
    expect(clientConfigFile("claude-desktop", win)).toContain("Claude");
    expect(clientConfigFile("cursor", mac)).toContain(".cursor/mcp.json");
    expect(clientConfigFile("windsurf", mac)).toContain(".codeium/windsurf/mcp_config.json");
  });

  it("uses `servers` for VS Code and `mcpServers` for Claude/Cursor/Gemini", () => {
    expect(configKeyFor("vscode")).toBe("servers");
    expect(configKeyFor("cursor")).toBe("mcpServers");
    expect(configKeyFor("claude-desktop")).toBe("mcpServers");
    expect(configKeyFor("gemini")).toBe("mcpServers");
  });

  it("resolves gemini/opencode/codex fallback files under home", () => {
    const mac = { ...currentOsPaths(), home: "/Users/me", plat: "darwin" as const };
    expect(clientConfigFile("gemini", mac)).toBe("/Users/me/.gemini/settings.json");
    expect(opencodeConfigFile(mac)).toBe("/Users/me/.config/opencode/opencode.json");
    expect(codexConfigFile(mac)).toBe("/Users/me/.codex/config.toml");
  });

  it("stable server path honors QUICKSPOT_MCP_DIR", () => {
    process.env.QUICKSPOT_MCP_DIR = "/tmp/qsmcp-test";
    expect(stableServerPath()).toBe("/tmp/qsmcp-test/index.js");
    delete process.env.QUICKSPOT_MCP_DIR;
    expect(stableServerPath()).toContain("index.js");
  });
});

describe("mergeConfig", () => {
  const entry = buildEntry("/stable/index.js", "/usr/bin/node");

  it("creates a fresh config when none exists", () => {
    const out = JSON.parse(mergeConfig(null, "mcpServers", entry));
    expect(out.mcpServers.quickspot).toEqual(entry);
  });

  it("preserves other servers and top-level keys", () => {
    const existing = JSON.stringify({ mcpServers: { other: { command: "x", args: [] } }, other: 1 });
    const out = JSON.parse(mergeConfig(existing, "mcpServers", entry));
    expect(out.mcpServers.other.command).toBe("x");
    expect(out.mcpServers.quickspot).toEqual(entry);
    expect(out.other).toBe(1);
  });

  it("overwrites a stale quickspot entry and throws on broken JSON", () => {
    const existing = JSON.stringify({ mcpServers: { quickspot: { command: "old", args: [] } } });
    const out = JSON.parse(mergeConfig(existing, "mcpServers", entry));
    expect(out.mcpServers.quickspot.command).toBe("/usr/bin/node");
    expect(() => mergeConfig("{broken", "mcpServers", entry)).toThrow();
    expect(() => mergeConfig("[1,2]", "mcpServers", entry)).toThrow();
  });
});

describe("removeFromConfig", () => {
  it("removes only our entry and reports null when absent", () => {
    const withEntry = JSON.stringify({ mcpServers: { quickspot: { command: "n", args: [] }, other: 1 } });
    const out = JSON.parse(removeFromConfig(withEntry, "mcpServers")!);
    expect("quickspot" in out.mcpServers).toBe(false);
    expect(out.mcpServers.other).toBe(1);
    expect(removeFromConfig(JSON.stringify({ mcpServers: {} }), "mcpServers")).toBeNull();
  });
});

describe("mergeOpenCode (v2 shape)", () => {
  const entry = openCodeEntry("/stable/index.js", "/usr/bin/node");

  it("creates mcp.servers.quickspot from scratch", () => {
    const out = JSON.parse(mergeOpenCode(null, entry));
    expect(out.mcp.servers.quickspot).toEqual({ type: "local", command: ["/usr/bin/node", "/stable/index.js"] });
  });

  it("preserves v1-style direct entries and other servers", () => {
    const existing = JSON.stringify({
      mcp: { sentry: { type: "remote", url: "https://x.dev" }, servers: { other: { type: "local", command: ["y"] } } },
    });
    const out = JSON.parse(mergeOpenCode(existing, entry));
    expect(out.mcp.sentry.url).toBe("https://x.dev");
    expect(out.mcp.servers.other.command).toEqual(["y"]);
    expect(out.mcp.servers.quickspot.type).toBe("local");
  });

  it("throws on broken JSON and removes only our entry", () => {
    expect(() => mergeOpenCode("{broken", entry)).toThrow();
    const withEntry = JSON.stringify({ mcp: { servers: { quickspot: entry, other: 1 } } });
    const out = JSON.parse(removeOpenCode(withEntry)!);
    expect("quickspot" in out.mcp.servers).toBe(false);
    expect(out.mcp.servers.other).toBe(1);
    expect(removeOpenCode(JSON.stringify({ mcp: { servers: {} } }))).toBeNull();
  });
});

describe("codex TOML upsert", () => {
  const entry = codexEntry("/stable/index.js", "/usr/bin/node");

  it("creates a fresh file with our table", () => {
    const out = upsertCodexToml(null, entry);
    expect(out).toContain("[mcp_servers.quickspot]");
    expect(out).toContain('command = "/usr/bin/node"');
    expect(out).toContain('args = ["/stable/index.js"]');
  });

  it("appends without touching existing tables", () => {
    const existing = '[mcp_servers.other]\ncommand = "x"\nargs = []\n';
    const out = upsertCodexToml(existing, entry);
    expect(out).toContain('[mcp_servers.other]\ncommand = "x"');
    expect(out).toContain("[mcp_servers.quickspot]");
  });

  it("replaces a stale quickspot table in place", () => {
    const existing = '[mcp_servers.quickspot]\ncommand = "old"\nargs = []\n\n[other]\nfoo = 1\n';
    const out = upsertCodexToml(existing, entry);
    expect(out).not.toContain('"old"');
    expect(out).toContain('command = "/usr/bin/node"');
    expect(out).toContain("[other]");
    expect(out.match(/\[mcp_servers\.quickspot\]/g)).toHaveLength(1);
  });

  it("removes only our table and reports null when absent", () => {
    const withEntry = '[mcp_servers.quickspot]\ncommand = "n"\n\n[other]\nfoo = 1\n';
    const out = removeCodexToml(withEntry)!;
    expect(out).not.toContain("quickspot");
    expect(out).toContain("[other]");
    expect(removeCodexToml("[other]\nfoo = 1\n")).toBeNull();
  });
});
