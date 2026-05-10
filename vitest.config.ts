import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@/lib/generated/prisma/client": path.resolve(__dirname, "./lib/generated/prisma/client"),
      "@/lib/generated/prisma": path.resolve(__dirname, "./lib/generated/prisma/client"),
      "@": path.resolve(__dirname, "./"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["dotenv/config"],
  },
});
