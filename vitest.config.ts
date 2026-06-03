import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["__tests__/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".claude/**", ".claire/**"],
    environment: "node",
    globals: true,
    setupFiles: ["dotenv/config"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      exclude: ["node_modules/**", ".claude/**", ".claire/**"],
    },
  },
});
