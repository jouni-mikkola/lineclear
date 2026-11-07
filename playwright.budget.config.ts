import { defineConfig } from "@playwright/test";

// `bun scripts/budget.ts`: the speed budget's browser run (ui/budget). The script starts the demo server and passes its address and pid.
export default defineConfig({
  testDir: "ui/budget",
  testMatch: "*.pw.ts",
  workers: 1,
  timeout: 180_000,
  reporter: "line",
  use: { colorScheme: "dark" },
});
