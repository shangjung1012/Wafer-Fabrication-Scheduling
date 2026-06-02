import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["dotenv/config"],
    coverage: {
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
