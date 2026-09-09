/// <reference types="vite/client" />

// Minimal typing for the contrast guard (node test env), without pulling in
// @types/node for the whole project.
declare module "node:fs" {
  export function readFileSync(path: unknown, encoding: "utf8"): string;
}
