// The canary an older stable's promotion runs on next: this checkout's service on spare ports must pass the smoke
// check. `bun scripts/canary.ts` prints one line per failure and exits 1 if there is one.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const r = spawnSync(process.execPath, [join(import.meta.dir, "smoke.ts"), "branch"], { encoding: "utf8" });
const out = `${r.stdout}${r.stderr}`.trim();
if (out) console.log(out);
process.exit(r.status === 0 && !out ? 0 : 1);
