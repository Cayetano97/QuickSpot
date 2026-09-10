import { describe, expect, it } from "vitest";
import {
  defaults,
  findActionIndex,
  isHexColor,
  loadFrom,
  parseConfig,
  sanitize,
  sanitizeGroups,
  saveTo,
  serializeConfig,
  validLanguage,
  validTheme,
} from "./config.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), "qsmcp-")), "quickspot.config.json");
}

describe("parseConfig (mirror of Rust parse_config)", () => {
  it("throws on malformed JSON or missing actions array", () => {
    expect(() => parseConfig("{ nope")).toThrow();
    expect(() => parseConfig("{}")).toThrow();
    expect(() => parseConfig('{"actions":{}}')).toThrow();
  });

  it("skips items missing name/kind/value or with unknown kind", () => {
    const cfg = parseConfig(`{"actions":[
      {"name":"Ok","kind":"url","value":"https://x.dev"},
      {"name":"No value","kind":"url"},
      {"kind":"url","value":"https://x.dev"},
      {"name":"Bad","kind":"ftp","value":"x"},
      42]}`);
    expect(cfg.actions.map((a) => a.name)).toEqual(["Ok"]);
  });

  it("parses sequences with leaf steps and drops nested/empty ones at sanitize", () => {
    const cfg = parseConfig(`{"actions":[
      {"name":"Morning","kind":"sequence","steps":[
        {"kind":"folder","value":"/tmp"},
        {"kind":"url","value":"https://x.dev"}]}]}`);
    expect(cfg.actions[0].steps).toHaveLength(2);
    expect(parseConfig(`{"actions":[{"name":"E","kind":"sequence","steps":[]}]}`).actions).toHaveLength(0);
  });

  it("parses groups, language, magnify, icons and theme like Rust", () => {
    const cfg = parseConfig(
      `{"groups":[{"id":"w","name":"W","color":"#5e9eff"},{"id":"","name":"X","color":"red"}],
        "language":"es","magnify":false,"showIcons":false,"theme":"deep","actions":[]}`,
    );
    expect(cfg.groups).toHaveLength(1);
    expect(cfg.language).toBe("es");
    expect(cfg.magnify).toBe(false);
    expect(cfg.showIcons).toBe(false);
    expect(cfg.theme).toBe("deep");
    const sys = parseConfig(`{"theme":"system","language":"","actions":[]}`);
    expect(sys.theme).toBeNull();
    expect(sys.language).toBeNull();
  });
});

describe("loadFrom", () => {
  it("falls back to the 3 builtin defaults when missing or broken", () => {
    expect(loadFrom("/no/such/file.json").actions).toHaveLength(3);
    const p = tmpFile();
    writeFileSync(p, "{bad");
    expect(loadFrom(p).actions).toEqual(defaults());
  });
});

describe("sanitize (mirror of Rust sanitize)", () => {
  it("trims and drops empty names/values", () => {
    const out = sanitize([
      { name: "  A  ", kind: "url", value: "  https://a.dev  " },
      { name: "", kind: "url", value: "https://b.dev" },
      { name: "C", kind: "command", value: "   " },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "A", value: "https://a.dev" });
  });

  it("normalizes sequences: clears value/browser, drops nested+blank, caps at 5", () => {
    const out = sanitize([
      {
        name: " M ",
        kind: "sequence",
        value: "junk",
        browser: "junk",
        group: "  ",
        steps: [
          { kind: "url", value: " https://a.dev " },
          { kind: "sequence" as never, value: "nested" },
          { kind: "command", value: "   " },
          { kind: "file", value: "/a" },
          { kind: "folder", value: "/b" },
          { kind: "url", value: "https://c.dev" },
          { kind: "url", value: "https://d.dev" },
        ],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe("");
    expect(out[0].browser).toBeUndefined();
    expect(out[0].group).toBeUndefined();
    expect(out[0].steps).toHaveLength(5);
  });

  it("drops sequences without runnable steps; keeps browser only on url", () => {
    expect(sanitize([{ name: "B", kind: "sequence", value: "", steps: [{ kind: "url", value: "  " }] }])).toHaveLength(0);
    const out = sanitize([{ name: "U", kind: "url", value: "https://u.dev", browser: "  /bin/ff  " }]);
    expect(out[0].browser).toBe("  /bin/ff  ");
    const cmd = sanitize([{ name: "C", kind: "command", value: "echo", browser: "/bin/x" }]);
    expect(cmd[0].browser).toBeUndefined();
  });
});

describe("sanitizeGroups + validators", () => {
  it("drops blank id/name and non-#rrggbb colors, trims the rest", () => {
    const out = sanitizeGroups([
      { id: " w ", name: " W ", color: " #5e9eff " },
      { id: "", name: "X", color: "#5e9eff" },
      { id: "y", name: "Y", color: "red" },
    ]);
    expect(out).toEqual([{ id: "w", name: "W", color: "#5e9eff" }]);
  });

  it("accepts uppercase hex, rejects short/missing-hash", () => {
    expect(isHexColor("#5E9EFF")).toBe(true);
    expect(isHexColor("#5e9e")).toBe(false);
    expect(isHexColor("5e9eff")).toBe(false);
    expect(validLanguage("zh-TW")).toBe(true);
    expect(validLanguage("muy largo")).toBe(false);
    expect(validTheme("deep")).toBe(true);
    expect(validTheme("sepia")).toBe(false);
  });
});

describe("serializeConfig + saveTo round-trip", () => {
  it("omits defaults (language/magnify/icons/theme/groups) like Rust save_to", () => {
    const text = serializeConfig({
      actions: [{ name: "A", kind: "url", value: "https://a.dev" }],
      groups: [],
      language: null,
      magnify: true,
      showIcons: true,
      theme: null,
    });
    expect(text).not.toContain("language");
    expect(text).not.toContain("magnify");
    expect(text).not.toContain("showIcons");
    expect(text).not.toContain("theme");
    expect(text).not.toContain("groups");
  });

  it("writes atomically and reads back identically", () => {
    const p = tmpFile();
    const cfg = {
      actions: [{ name: "A", kind: "url" as const, value: "https://a.dev" }],
      groups: [{ id: "w", name: "W", color: "#5e9eff" }],
      language: "es",
      magnify: false,
      showIcons: true,
      theme: null,
    };
    saveTo(p, cfg);
    expect(loadFrom(p)).toEqual(cfg);
    // Second save keeps a `.bak` of the first write.
    saveTo(p, { ...cfg, language: "en" });
    expect(loadFrom(p).language).toBe("en");
    expect(readFileSync(p + ".bak", "utf8")).toContain("https://a.dev");
  });
});

describe("findActionIndex", () => {
  const actions = [
    { name: "Deploy", kind: "command" as const, value: "make deploy" },
    { name: "YouTube", kind: "url" as const, value: "https://youtube.com" },
  ];
  it("resolves by index with bounds check", () => {
    expect(findActionIndex(actions, 1)).toBe(1);
    expect(findActionIndex(actions, 9)).toBe(-1);
  });
  it("resolves by case-insensitive trimmed name", () => {
    expect(findActionIndex(actions, "  deploy ")).toBe(0);
    expect(findActionIndex(actions, "missing")).toBe(-1);
  });
});
