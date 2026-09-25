import { resolve } from "node:path"

import { defineConfig } from "vitest/config"

export default defineConfig({
  root: resolve(__dirname),
  test: {
    environment: "node",
    setupFiles: [resolve(__dirname, "tests/setup.ts")],
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
})
