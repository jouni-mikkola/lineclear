import { defineConfig } from "@playwright/test";
import { FIXTURE, UI_PORT, unsetLineclearEnv } from "./ui/test/fixture.ts";

// The UI bar's browser tests: `bun run ui:test`. The pages come from `lineclear run`, on an empty config so that
// its rules have no project to act on. The views read Lineclear's and pi's files from a folder the tests write.
const port = UI_PORT;

export default defineConfig({
  testDir: "ui/test",
  testMatch: "*.pw.ts",
  snapshotPathTemplate: "ui/test/screens/{arg}-{projectName}{ext}",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { toHaveScreenshot: { maxDiffPixels: 100, animations: "disabled" } },
  use: { baseURL: `http://127.0.0.1:${port}`, colorScheme: "dark" },
  projects: [
    { name: "1440", use: { viewport: { width: 1440, height: 900 } } },
    { name: "390", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
    // the frame's other two widths: the tablet and the wide screen
    { name: "768", testMatch: "frame.pw.ts", use: { viewport: { width: 768, height: 1024 } } },
    { name: "2560", testMatch: "frame.pw.ts", use: { viewport: { width: 2560, height: 1300 } } },
  ],
  webServer: {
    command: `rm -rf "${FIXTURE}" && mkdir -p "${FIXTURE}/config" "${FIXTURE}/lineclear" "${FIXTURE}/pi" "${FIXTURE}/home" && trap 'kill $pid; wait $pid; rm -rf "${FIXTURE}"' TERM INT && { env ${unsetLineclearEnv()} HOME="${FIXTURE}/home" LINECLEAR_CONFIG="${FIXTURE}/config" LINECLEAR_STATE="${FIXTURE}/state" LINECLEAR_HOME="${FIXTURE}/lineclear" PI_CODING_AGENT_DIR="${FIXTURE}/pi" LINECLEAR_SERVER_BIN="$PWD/ui/test/fake-lineclear" LINECLEAR_PLAYWRIGHT_CLI="$PWD/ui/test/fake-playwright-cli" LINECLEAR_SSH="$PWD/ui/test/fake-ssh" LINECLEAR_BROWSER_LIST_MS=1000 LINECLEAR_DOCTOR_FILE="${FIXTURE}/doctor.json" FAKE_SSH_SECONDS=2 FAKE_SSH_LOG="${FIXTURE}/ssh.log" PI_BIN="$PWD/ui/test/fake-pi" LINECLEAR_PORT=${port} bin/lineclear run & pid=$!; wait $pid; }`,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    url: `http://127.0.0.1:${port}/design`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
