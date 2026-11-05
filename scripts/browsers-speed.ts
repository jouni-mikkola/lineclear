// How fast the Agent browsers view's data is. Usage: bun scripts/browsers-speed.ts [--fake <sessions> <ms each call takes>]
// Without --fake it asks the real playwright-cli for the sessions open now. It asks the way the page does: the list,
// then each session's thumbnail at once, then the list and the pictures again.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webApi } from "../src/web.ts";

const fake = process.argv.indexOf("--fake");
const env: Record<string, string | undefined> = { ...process.env };
if (fake > 0) {
  const n = Number(process.argv[fake + 1] ?? 10);
  const dir = mkdtempSync(join(tmpdir(), "lc-speed-"));
  mkdirSync(join(dir, "shepherdr"), { recursive: true });
  mkdirSync(join(dir, "config"), { recursive: true });
  writeFileSync(
    join(dir, "browsers.json"),
    JSON.stringify({ browsers: Array.from({ length: n }, (_, i) => ({ name: `T-${i + 1}`, workspace: "0abc", status: "open" })) }),
  );
  Object.assign(env, {
    LINECLEAR_PLAYWRIGHT_CLI: join(import.meta.dir, "..", "ui", "test", "fake-playwright-cli"),
    LINECLEAR_FAKE_DELAY: String(Number(process.argv[fake + 2] ?? 1000) / 1000),
    LINECLEAR_SHEPHERDR_DIR: join(dir, "shepherdr"),
    LINECLEAR_CONFIG: join(dir, "config"),
  });
}
const handle = webApi(env);
const ask = async (path: string) => {
  const at = performance.now();
  const r = await handle(new Request(`http://127.0.0.1:7420${path}`));
  const body = new Uint8Array(await r.arrayBuffer());
  return { ms: Math.round(performance.now() - at), status: r.status, bytes: body.length, body };
};
const ms = (a: number[]) => a.map((x) => `${x}`).join(" ");

const list1 = await ask("/api/browsers");
const sessions = (JSON.parse(new TextDecoder().decode(list1.body)) as { session: string }[]).map((s) => s.session);
console.log(`sessions ${sessions.length}`);
console.log(`list, first: ${list1.ms} ms, ${list1.bytes} bytes`);
const start = performance.now();
const first = await Promise.all(
  sessions.map(async (s) => ({ ...(await ask(`/api/browsers/${s}/picture?size=thumb`)), done: Math.round(performance.now() - start) })),
);
console.log(
  `first thumbnail of each session, asked together: answered at ms ${ms(first.map((p) => p.done).sort((a, b) => a - b))}; bytes ${ms(first.map((p) => p.bytes))}`,
);
const again = await Promise.all(sessions.map((s) => ask(`/api/browsers/${s}/picture?size=thumb`)));
console.log(`second thumbnail of each, ms: ${ms(again.map((p) => p.ms))}`);
const list2 = await ask("/api/browsers");
console.log(`list, again: ${list2.ms} ms`);
const full = await ask(`/api/browsers/${sessions[0]}/picture`);
console.log(`full picture of one, ms: ${full.ms}; bytes ${full.bytes}`);
const times: number[] = [];
for (let i = 0; i < 5; i++) {
  times.push((await ask("/api/browsers")).ms);
  await Bun.sleep(1100);
}
console.log(`list polled every 1.1 s, ms: ${ms(times)}`);
process.exit(0);
