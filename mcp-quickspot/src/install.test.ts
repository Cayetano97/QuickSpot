import { describe, expect, it } from "vitest";
import {
  buildEntry,
  cliAddArgs,
  clientConfigFile,
  codexConfigFile,
  codexEntry,
  configKeyFor,
  copilotConfigFile,
  currentOsPaths,
  install,
  mergeConfig,
  mergeOpenCode,
  opencodeConfigFile,
  openCodeEntry,
  removeCodexToml,
  removeFromConfig,
  removeOpenCode,
  stableServerPath,
  uninstall,
  upsertCodexToml,
} from "./install.js";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("client config paths", () => {
  it("resolves per-OS desktop config locations", () => {
    const mac = {
      ...currentOsPaths(),
      home: "/Users/me",
      plat: "darwin" as const,
      xdgConfig: join("/Users/me", ".config"),
    };
    expect(clientConfigFile("claude-desktop", mac)).toContain(join("Library", "Application Support", "Claude"));
    const win = { ...currentOsPaths(), home: "C:\\U", plat: "win32" as const, appdata: "C:\\U\\AppData\\Roaming" };
    expect(clientConfigFile("claude-desktop", win)).toContain("Claude");
    expect(clientConfigFile("cursor", mac)).toContain(join(".cursor", "mcp.json"));
    expect(clientConfigFile("windsurf", mac)).toContain(join(".codeium", "windsurf", "mcp_config.json"));
  });

  it("uses `servers` for VS Code and `mcpServers` for Claude/Cursor/Gemini", () => {
    expect(configKeyFor("vscode")).toBe("servers");
    expect(configKeyFor("cursor")).toBe("mcpServers");
    expect(configKeyFor("claude-desktop")).toBe("mcpServers");
    expect(configKeyFor("gemini")).toBe("mcpServers");
  });

  it("resolves gemini/opencode/codex fallback files under home", () => {
    const mac = {
      ...currentOsPaths(),
      home: "/Users/me",
      plat: "darwin" as const,
      xdgConfig: join("/Users/me", ".config"),
    };
    const oldCodex = process.env.CODEX_HOME;
    delete process.env.CODEX_HOME;
    try {
      expect(clientConfigFile("gemini", mac)).toBe(join("/Users/me", ".gemini", "settings.json"));
      expect(opencodeConfigFile(mac)).toBe(join("/Users/me", ".config", "opencode", "opencode.json"));
      expect(codexConfigFile(mac)).toBe(join("/Users/me", ".codex", "config.toml"));
    } finally {
      if (oldCodex === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = oldCodex;
    }
  });

  it("stable server path honors QUICKSPOT_MCP_DIR", () => {
    const old = process.env.QUICKSPOT_MCP_DIR;
    process.env.QUICKSPOT_MCP_DIR = "/tmp/qsmcp-test";
    try {
      expect(stableServerPath()).toBe(join("/tmp/qsmcp-test", "index.js"));
    } finally {
      if (old === undefined) delete process.env.QUICKSPOT_MCP_DIR;
      else process.env.QUICKSPOT_MCP_DIR = old;
    }
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

  it("also removes a legacy direct mcp.quickspot entry", () => {
    const existing = JSON.stringify({
      mcp: { quickspot: entry, sentry: { type: "remote", url: "https://x.dev" } },
    });
    const out = JSON.parse(removeOpenCode(existing)!);
    expect("quickspot" in out.mcp).toBe(false);
    expect(out.mcp.sentry.url).toBe("https://x.dev");
  });
});

describe("CLI scopes", () => {
  const entry = buildEntry("/stable/index.js", "/usr/bin/node");

  it("registers OpenCode globally and Claude Code at user scope", () => {
    expect(cliAddArgs("opencode", entry)).toEqual([
      "mcp", "add", "--global", "quickspot", "--", "/usr/bin/node", "/stable/index.js",
    ]);
    expect(cliAddArgs("claude-code", entry)).toEqual([
      "mcp", "add", "--scope", "user", "quickspot", "--", "/usr/bin/node", "/stable/index.js",
    ]);
    expect(cliAddArgs("codex", entry)).toEqual([
      "mcp", "add", "quickspot", "--", "/usr/bin/node", "/stable/index.js",
    ]);
  });
});

describe("client config locations honor env overrides", () => {
  const os = { ...currentOsPaths(), home: "/Users/me" };

  it("uses XDG_CONFIG_HOME for OpenCode", () => {
    const old = process.env.XDG_CONFIG_HOME;
    const xdg = mkdtempSync(join(tmpdir(), "qsmcp-xdg-"));
    process.env.XDG_CONFIG_HOME = xdg;
    try {
      const p = { ...currentOsPaths(), home: "/Users/me" };
      expect(opencodeConfigFile(p)).toBe(join(xdg, "opencode", "opencode.json"));
    } finally {
      if (old === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = old;
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it("uses CODEX_HOME for Codex and COPILOT_HOME for VS Code Copilot", () => {
    const oldCodex = process.env.CODEX_HOME;
    const oldCopilot = process.env.COPILOT_HOME;
    process.env.CODEX_HOME = "/tmp/qsmcp-codex";
    process.env.COPILOT_HOME = "/tmp/qsmcp-copilot";
    try {
      expect(codexConfigFile(os)).toBe(join("/tmp/qsmcp-codex", "config.toml"));
      expect(copilotConfigFile(os)).toBe(join("/tmp/qsmcp-copilot", "mcp-config.json"));
    } finally {
      if (oldCodex === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = oldCodex;
      if (oldCopilot === undefined) delete process.env.COPILOT_HOME;
      else process.env.COPILOT_HOME = oldCopilot;
    }
  });
});

describe("install", () => {
  function withHome<T>(fn: (home: string) => T): T {
    const home = mkdtempSync(join(tmpdir(), "qsmcp-install-"));
    const keys = ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "COPILOT_HOME", "XDG_CONFIG_HOME"] as const;
    const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      process.env.APPDATA = join(home, "AppData", "Roaming");
      process.env.LOCALAPPDATA = join(home, "AppData", "Local");
      delete process.env.COPILOT_HOME;
      delete process.env.XDG_CONFIG_HOME;
      return fn(home);
    } finally {
      for (const k of keys) {
        if (old[k] === undefined) delete process.env[k];
        else process.env[k] = old[k];
      }
      rmSync(home, { recursive: true, force: true });
    }
  }

  it("writes a VS Code Copilot entry with type stdio", () => {
    withHome((home) => {
      const res = install(
        { clients: ["vscode"], noCopy: true, serverPath: "/stable/index.js", nodePath: "/usr/bin/node" },
        "/running/index.js",
      );
      expect(res.clients[0].failed).toBe(false);
      const file = join(home, ".copilot", "mcp-config.json");
      const cfg = JSON.parse(readFileSync(file, "utf8"));
      expect(cfg.mcpServers.quickspot).toEqual({
        type: "stdio",
        command: "/usr/bin/node",
        args: ["/stable/index.js"],
      });
    });
  });

  it("updates an existing legacy VS Code mcp.json too", () => {
    withHome(() => {
      const legacy = clientConfigFile("vscode");
      mkdirSync(join(legacy, ".."), { recursive: true });
      writeFileSync(legacy, JSON.stringify({ servers: { other: { command: "x", args: [] } } }));
      install(
        { clients: ["vscode"], noCopy: true, serverPath: "/stable/index.js", nodePath: "/usr/bin/node" },
        "/running/index.js",
      );
      const cfg = JSON.parse(readFileSync(legacy, "utf8"));
      expect(cfg.servers.other.command).toBe("x");
      expect(cfg.servers.quickspot.type).toBe("stdio");
    });
  });

  it("marks a broken client JSON as failed and leaves it untouched", () => {
    withHome((home) => {
      const file = join(home, ".cursor", "mcp.json");
      mkdirSync(join(home, ".cursor"), { recursive: true });
      writeFileSync(file, "{ broken");
      const res = install(
        { clients: ["cursor"], noCopy: true, serverPath: "/stable/index.js", nodePath: "/usr/bin/node" },
        "/running/index.js",
      );
      expect(res.clients[0].failed).toBe(true);
      expect(readFileSync(file, "utf8")).toBe("{ broken");
    });
  });
});

describe("uninstall --remove-files", () => {
  it("deletes the stable copy when asked", () => {
    const dir = mkdtempSync(join(tmpdir(), "qsmcp-rm-"));
    const old = process.env.QUICKSPOT_MCP_DIR;
    process.env.QUICKSPOT_MCP_DIR = dir;
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.js"), "// bundle");
      const res = uninstall({ clients: [], removeFiles: true });
      expect(res.failed).toBe(false);
      expect(res.lines.join("\n")).toContain("server: removed");
      expect(() => readFileSync(join(dir, "index.js"), "utf8")).toThrow();
    } finally {
      if (old === undefined) delete process.env.QUICKSPOT_MCP_DIR;
      else process.env.QUICKSPOT_MCP_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
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
