/** Zod input schemas for every MCP tool. They validate shape; `config.ts`
 * `sanitize` enforces the Rust-compatible semantics on top. The kind enums
 * and the sequence cap come from `types.ts` so the model has one source of
 * truth (this file used to duplicate them by hand). */
import * as z from "zod/v4";
import {
  ACTION_KINDS,
  MAX_SEQUENCE_STEPS,
  SEQUENCE_STEP_KINDS,
  type ActionKind,
  type SequenceStepKind,
} from "./types.js";

export const ActionKindSchema = z.enum(
  ACTION_KINDS as unknown as [ActionKind, ...ActionKind[]],
);

export const StepKindSchema = z.enum(
  SEQUENCE_STEP_KINDS as unknown as [SequenceStepKind, ...SequenceStepKind[]],
);

export const SequenceStepSchema = z.object({
  kind: StepKindSchema,
  value: z.string().trim().min(1, "step value must not be empty"),
  browser: z.string().optional(),
});

export const ActionRefSchema = z.union([
  z.number().int().min(0),
  z.string().trim().min(1),
]);

export const CreateActionSchema = z
  .object({
    name: z.string().trim().min(1, "name must not be empty"),
    kind: ActionKindSchema,
    // Ignored for sequences, but requiring it forced every sequence call to
    // send a meaningless empty string. Default it instead.
    value: z.string().default(""),
    browser: z.string().optional(),
    hint: z.string().optional(),
    group: z.string().optional(),
    steps: z.array(SequenceStepSchema).max(MAX_SEQUENCE_STEPS).optional(),
  })
  .refine(
    (a) => (a.kind === "sequence" ? (a.steps?.length ?? 0) > 0 : a.value.trim().length > 0),
    { message: "sequence needs steps; other kinds need a non-empty value" },
  );

export const UpdateActionSchema = z.object({
  ref: ActionRefSchema.describe("Action index or exact (case-insensitive) name"),
  name: z.string().trim().min(1).optional(),
  kind: ActionKindSchema.optional(),
  value: z.string().optional(),
  browser: z.string().nullable().optional(),
  hint: z.string().nullable().optional(),
  group: z.string().nullable().optional(),
  steps: z.array(SequenceStepSchema).max(MAX_SEQUENCE_STEPS).nullable().optional(),
});

export const DeleteActionSchema = z.object({
  ref: ActionRefSchema.describe("Action index or exact (case-insensitive) name"),
});

export const MoveActionSchema = z.object({
  ref: ActionRefSchema.describe("Action index or exact (case-insensitive) name"),
  to: z.number().int().min(0).describe("Destination index (clamped)"),
});

export const CreateGroupSchema = z.object({
  id: z.string().trim().min(1).optional().describe("Defaults to a slug of name"),
  name: z.string().trim().min(1, "name must not be empty"),
  color: z.string().trim().regex(/^#[0-9a-f]{6}$/i, "color must be #rrggbb"),
});

export const DeleteGroupSchema = z.object({
  id: z.string().trim().min(1),
  unassignActions: z.boolean().default(true).describe("Clear the group from member actions"),
});

export type CreateAction = z.infer<typeof CreateActionSchema>;
export type UpdateAction = z.infer<typeof UpdateActionSchema>;
