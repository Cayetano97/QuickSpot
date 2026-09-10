import { describe, expect, it } from "vitest";
import { decideEntryArgs, stripYes } from "./index.js";

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
