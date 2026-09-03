import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // src only. lib/ is tsc output, so without this every test file runs
    // twice - once as source, once as a stale compiled copy of itself.
    include: ["src/**/*.test.ts"],
  },
});
