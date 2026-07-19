import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    maxConcurrency: 1,
    maxWorkers: 1,
    pool: "threads",
  },
});
