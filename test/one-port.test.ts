import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmp, waitFor } from "./helpers.ts";

test("one process serves the pages, the home data and the board's snapshot on one port", async () => {
  const dir = tmp("one-server");
  mkdirSync(join(dir, "dist"), { recursive: true });
  mkdirSync(join(dir, "home"), { recursive: true });
  mkdirSync(join(dir, "config"), { recursive: true });
  writeFileSync(join(dir, "dist", "index.html"), "<p>app</p>");
  writeFileSync(join(dir, "doctor.json"), "[]");
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = probe.port as number;
  probe.stop(true);
  const root = join(import.meta.dir, "..", "server");
  const server = join(root, "server");
  if (!existsSync(join(root, "generated", "server-plugins.ts"))) Bun.spawnSync(["bun", "scripts/build-plugins.ts"], { cwd: root });
  const child = Bun.spawn([process.execPath, "main.ts"], {
    cwd: server,
    env: {
      ...process.env,
      HOME: dir,
      // no browser tool on the path: the server's read of the agents' browsers would leave a process behind
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      LINECLEAR_HOME: join(dir, "home"),
      LINECLEAR_CONFIG: join(dir, "config"),
      LINECLEAR_SCRATCH: "1",
      HERDR_SOCKET_PATH: join(dir, "no-herdr.sock"),
      LINECLEAR_PORT: String(port),
      LINECLEAR_MOUNT: join(import.meta.dir, "..", "src", "serve.ts"),
      LINECLEAR_WEB_DIST: join(dir, "dist"),
      LINECLEAR_DOCTOR_FILE: join(dir, "doctor.json"),
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitFor(async () => (await fetch(`${base}/`).catch(() => undefined))?.ok === true, "the server answers", 15_000);
    expect(await (await fetch(`${base}/`)).text()).toBe("<p>app</p>");
    const home = await fetch(`${base}/api/home`);
    expect(home.status).toBe(200);
    expect(await home.json()).toHaveProperty("projects");
    const snapshot = await fetch(`${base}/api/snapshot`);
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toHaveProperty("tasks");
  } finally {
    child.kill("SIGKILL");
    await child.exited;
  }
}, 20_000);
