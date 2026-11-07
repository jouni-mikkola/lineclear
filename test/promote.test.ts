import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp } from "./helpers.ts";

const script = join(import.meta.dir, "..", "scripts", "promote.ts");
const sha = (c: string) => c.repeat(40);

function promote(commit: string) {
  const dir = tmp("promote");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const runs: Record<string, string> = {
    [sha("a")]: '[{"status":"completed","conclusion":"failure"}]',
    [sha("b")]: '[{"status":"in_progress","conclusion":""}]',
    [sha("c")]: '[{"status":"completed","conclusion":"success"}]',
  };
  const cases = Object.entries(runs)
    .map(([k, v]) => `*${k}*) echo '${v}';;`)
    .join("\n");
  writeFileSync(join(bin, "gh"), `#!/bin/sh\ncase "$*" in\n${cases}\nesac\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const marker = join(dir, "installed");
  const installer = join(dir, "install.sh");
  writeFileSync(installer, `echo "$LINECLEAR_REF" > '${marker}'\n`);
  const r = Bun.spawnSync(["bun", script, commit], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LINECLEAR_INSTALL: installer },
  });
  return { code: r.exitCode, out: r.stdout.toString().trim(), installed: existsSync(marker) };
}

test("promote refuses a red and a pending commit and installs a green one", () => {
  expect(promote(sha("a"))).toMatchObject({ code: 1, installed: false });
  expect(promote(sha("b"))).toMatchObject({ code: 1, installed: false });
  expect(promote(sha("c"))).toEqual({ code: 0, out: sha("c"), installed: true });
});
