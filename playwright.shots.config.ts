import { defineConfig } from "@playwright/test";

// `bun run shots`: the app's views on the demo data (`lineclear run --demo`), one picture each at 390 and 1440 px.
const port = Number(process.env.LINECLEAR_SHOTS_PORT) || 7436;

export default defineConfig({
  testDir: "ui/shots",
  testMatch: "*.pw.ts",
  workers: 1,
  timeout: 120_000,
  use: { baseURL: `http://127.0.0.1:${port}`, colorScheme: "dark" },
  webServer: {
    command: `LINECLEAR_PORT=${port} exec bin/lineclear run --demo`,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
