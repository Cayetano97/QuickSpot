import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decideEntryArgs, parseClients, stripYes, SERVER_VERSION } from "./index.js";

describe("release metadata", () => {
  it("keeps the handshake version in sync with package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(SERVER_VERSION).toBe(pkg.version);
  });
});

describe("decideEntryArgs (opt-in gate)", () => {
  it("explicit actions always pass through", () => {
    for (const argv of [["--install"], ["--status"], ["--uninstall"], ["--help"], ["-h"], ["--version"], ["--install", "--clients=cursor"]]) {
      expect(decideEntryArgs(argv, true)).toBe("passthrough");
      expect(decideEntryArgs(argv, false)).toBe("passthrough");
    }
  });

  it("--yes/-y means explicit install consent", () => {
    expect(decideEntryArgs(["--yes"], false)).toBe("install-yes");
    expect(decideEntryArgs(["-y", "--clients=cursor"], false)).toBe("install-yes");
    expect(decideEntryArgs(["--yes"], true)).toBe("install-yes");
  });

  it("bare invocation serves piped hosts and prompts humans", () => {
    expect(decideEntryArgs([], false)).toBe("serve");
    expect(decideEntryArgs([], true)).toBe("prompt");
  });

  it("stray flags prompt on TTY and refuse without one", () => {
    expect(decideEntryArgs(["--clients=cursor"], true)).toBe("prompt");
    expect(decideEntryArgs(["--clients=cursor"], false)).toBe("refuse");
    expect(decideEntryArgs(["--dry-run"], false)).toBe("refuse");
  });

  it("stripYes removes consent flags", () => {
    expect(stripYes(["--yes", "--clients=cursor"])).toEqual(["--clients=cursor"]);
    expect(stripYes(["-y"])).toEqual([]);
  });
});

describe("parseClients", () => {
  it("accepts known clients and rejects typos with a clear message", () => {
    expect(parseClients("cursor,opencode")).toEqual(["cursor", "opencode"]);
    expect(parseClients(undefined)).toBeUndefined();
    expect(() => parseClients("cursor,bogus")).toThrow(/unknown client/);
  });
});
