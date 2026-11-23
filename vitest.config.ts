import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    benchmark: {
      // The hot paths are tiny; getter tracking overhead would dominate.
      suppressExportGetterWarnings: true,
    },
  },
});
