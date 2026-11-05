import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureServer } from "../src/measure-server.ts";

function fake(): { url: string; stop: () => void } {
  const s = Bun.serve({
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/api/loop-lag"
        ? Response.json({ windowMs: 2000, samples: 99, p50: 0.4, p95: 1.5, max: 310, cpu: 0.12 })
        : Response.json({ nodes: [{ id: 1 }] }),
  });
  return { url: `http://127.0.0.1:${s.port}`, stop: () => s.stop(true) };
}

test("measure --server prints p50, p95, max and the CPU share", async () => {
  const s = fake();
  const out: string[] = [];
  const code = await measureServer(["--server", "--window", "2"], (l) => out.push(l), { LINECLEAR_SHEPHERDR_URL: s.url });
  s.stop();
  expect(code).toBe(0);
  const text = out.join("\n");
  expect(text).toContain("p50 0.4 ms");
  expect(text).toContain("p95 1.5 ms");
  expect(text).toContain("max 310.0 ms");
  expect(text).toContain("12.0 %");
});

test("measure --server --profile saves the profile", async () => {
  const s = fake();
  const dir = mkdtempSync(join(tmpdir(), "prof-"));
  const out: string[] = [];
  const code = await measureServer(["--server", "--profile"], (l) => out.push(l), { LINECLEAR_SHEPHERDR_URL: s.url }, dir);
  s.stop();
  expect(code).toBe(0);
  expect(readdirSync(dir).filter((f) => f.endsWith(".cpuprofile"))).toHaveLength(1);
  expect(existsSync(join(dir, readdirSync(dir)[0] as string))).toBe(true);
});
