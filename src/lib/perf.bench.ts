import { test } from "vitest";
import type { Action } from "./model";
import { countMatches, filterActions, matchActions, normalizeActionNames } from "./model";
import { petalLayout, petalPath } from "./petals";
import { chipCenter } from "./easing";

/** A realistic worst case: a large config (the app has no action limit). */
function makeActions(n: number): Action[] {
  const kinds: Action["kind"][] = ["url", "app", "file", "folder", "command", "sequence"];
  return Array.from({ length: n }, (_, i) => ({
    name: `Action ${i} — ${["GitHub", "Slack", "Docs", "Terminal", "Figma"][i % 5]}`,
    kind: kinds[i % kinds.length],
    value: `https://example.com/${i}`,
  }));
}

const small = makeActions(200);
const large = makeActions(2000);

test("search filter (one keystroke)", async ({ bench }) => {
  await bench("filterActions, 200 actions", () => {
    filterActions(small, "git");
  }).run();
  await bench("filterActions, 2000 actions, no early matches", () => {
    filterActions(large, "zzzz");
  }).run();
});

test("result count (the 'more' caption)", async ({ bench }) => {
  await bench("countMatches, 200 actions", () => {
    countMatches(small, "git");
  }).run();
  await bench("countMatches, 2000 actions", () => {
    countMatches(large, "git");
  }).run();
});

test("one keystroke in the launcher (filter + count)", async ({ bench }) => {
  await bench("200 actions", () => {
    filterActions(small, "git");
    countMatches(small, "git");
  }).run();
  await bench("2000 actions", () => {
    filterActions(large, "git");
    countMatches(large, "git");
  }).run();
});

test("cached-name matching (the launcher's path)", async ({ bench }) => {
  const smallNames = normalizeActionNames(small);
  const largeNames = normalizeActionNames(large);
  await bench("matchActions, 200 actions + cached names", () => {
    matchActions(small, "git", smallNames);
  }).run();
  await bench("matchActions, 2000 actions + cached names", () => {
    matchActions(large, "git", largeNames);
  }).run();
  await bench("matchActions, 2000 actions, no early matches", () => {
    matchActions(large, "zzzz", largeNames);
  }).run();
});

test("before/after: one keystroke at 2000 actions", async ({ bench }) => {
  const names = normalizeActionNames(large);
  await bench("legacy: filter + count, names re-normalized twice", () => {
    filterActions(large, "git");
    countMatches(large, "git");
  }).run();
  await bench("current: one pass, cached names", () => {
    matchActions(large, "git", names);
  }).run();
});

test("normalizing every action name (once per config payload)", async ({ bench }) => {
  await bench("2000 normalized names", () => {
    normalizeActionNames(large);
  }).run();
});

test("petal ring layout", async ({ bench }) => {
  await bench("layout all 8 tiles", () => {
    for (let i = 0; i < 8; i++) petalLayout(i, 8);
  }).run();
  await bench("one shared path for 8 tiles", () => {
    petalPath(8);
  }).run();
});

test("classic pills layout", async ({ bench }) => {
  await bench("centre all 8 pills", () => {
    for (let i = 0; i < 8; i++) chipCenter(i, 8);
  }).run();
});
