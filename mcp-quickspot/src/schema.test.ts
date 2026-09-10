import { describe, expect, it } from "vitest";
import {
  CreateActionSchema,
  CreateGroupSchema,
  DeleteActionSchema,
  MoveActionSchema,
  UpdateActionSchema,
} from "./schema.js";

describe("tool schemas", () => {
  it("accepts every action kind and rejects unknown ones", () => {
    for (const kind of ["url", "command", "app", "file", "folder"] as const) {
      expect(CreateActionSchema.safeParse({ name: "A", kind, value: "v" }).success).toBe(true);
    }
    expect(
      CreateActionSchema.safeParse({ name: "S", kind: "sequence", steps: [{ kind: "url", value: "https://a.dev" }], value: "" })
        .success,
    ).toBe(true);
    expect(CreateActionSchema.safeParse({ name: "A", kind: "ftp", value: "v" }).success).toBe(false);
  });

  it("requires value for leaves and steps for sequences", () => {
    expect(CreateActionSchema.safeParse({ name: "A", kind: "url", value: "   " }).success).toBe(false);
    expect(CreateActionSchema.safeParse({ name: "S", kind: "sequence", value: "", steps: [] }).success).toBe(false);
    expect(CreateActionSchema.safeParse({ name: "", kind: "url", value: "v" }).success).toBe(false);
  });

  it("caps sequence steps at 5 and rejects nested sequences", () => {
    const steps = Array.from({ length: 6 }, (_, i) => ({ kind: "url" as const, value: `https://a.dev/${i}` }));
    expect(CreateActionSchema.safeParse({ name: "S", kind: "sequence", value: "", steps }).success).toBe(false);
    const nested = [{ kind: "sequence", value: "x" }];
    expect(CreateActionSchema.safeParse({ name: "S", kind: "sequence", value: "", steps: nested }).success).toBe(false);
  });

  it("update accepts partial patches with nullable clears", () => {
    expect(UpdateActionSchema.safeParse({ ref: 0, name: "B" }).success).toBe(true);
    expect(UpdateActionSchema.safeParse({ ref: "Deploy", browser: null }).success).toBe(true);
    expect(UpdateActionSchema.safeParse({ ref: "Deploy", kind: "ftp" }).success).toBe(false);
    expect(DeleteActionSchema.safeParse({ ref: "Deploy" }).success).toBe(true);
    expect(MoveActionSchema.safeParse({ ref: 0, to: 2 }).success).toBe(true);
    expect(MoveActionSchema.safeParse({ ref: 0, to: -1 }).success).toBe(false);
  });

  it("groups require #rrggbb colors", () => {
    expect(CreateGroupSchema.safeParse({ name: "W", color: "#5e9eff" }).success).toBe(true);
    expect(CreateGroupSchema.safeParse({ name: "W", color: "red" }).success).toBe(false);
    expect(CreateGroupSchema.safeParse({ name: "", color: "#5e9eff" }).success).toBe(false);
  });
});
