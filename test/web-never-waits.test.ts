import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectsFeed } from "../src/projects-feed.ts";
import { serveWeb } from "../src/web.ts";
import { tmp } from "./helpers.ts";

const dir = tmp("never-waits");
let server: ReturnType<typeof serveWeb>;

beforeAll(async () => {
  for (const d of ["config", "lineclear", "dist"]) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, "dist", "index.html"), "<!doctype html><title>x</title>");
  writeFileSync(join(dir, "dist", "favicon.ico"), "ico");
  // a doctor file marks a test run: a real server also starts the heal child at once, which takes the CPU the timed requests need
  const settings = {
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_HOME: join(dir, "lineclear"),
    LINECLEAR_DOCTOR_FILE: join(dir, "none.json"),
    HOME: dir,
  };
  const feed = projectsFeed(settings, 1_000, join(import.meta.dir, "fixtures", "slow-projects-worker.ts"));
  await feed.ready();
  server = serveWeb(join(dir, "dist"), { hostname: "127.0.0.1", port: 0 }, settings, undefined, feed);
});
afterAll(() => void server.stop(true));

async function timed(path: string) {
  const t = performance.now();
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`);
  await res.arrayBuffer();
  return { ms: performance.now() - t, status: res.status };
}

// the feed's thread is blocked in a 5 s read from the second snapshot on
test("a static file and /api/home answer within 200 ms while a read blocks for 5 s", async () => {
  await Bun.sleep(100);
  for (const path of ["/favicon.ico", "/api/home"]) {
    const r = await timed(path);
    expect(r.status).toBe(200);
    expect(r.ms).toBeLessThan(200);
  }
});

test("a feed whose first read fails fails its callers instead of leaving them waiting", async () => {
  const feed = projectsFeed({}, 1_000, join(import.meta.dir, "fixtures", "failing-projects-worker.ts"));
  await expect(feed.ready()).rejects.toThrow("no settings");
  feed.stop();
});
