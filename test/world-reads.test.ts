import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitWith } from "../src/git.ts";
import { setup } from "./rules-world.ts";

const WORLD = join(import.meta.dir, "..", "src", "world.ts");

test("a git that never answers is stopped and the read says it timed out", () => {
  const t = setup({ steps: [] });
  const slow = join(t.dir, "slow");
  mkdirSync(slow);
  writeFileSync(join(slow, "git"), "#!/bin/sh\nexec sleep 30\n");
  chmodSync(join(slow, "git"), 0o755);
  const started = Date.now();
  const r = gitWith({ timeout: 300, env: { ...process.env, PATH: `${slow}:${process.env.PATH}` } }, t.repo, "status");
  expect(Date.now() - started).toBeLessThan(5000);
  expect(r.ok).toBe(false);
  expect(r.err).toContain("timed out");
});

test("main's log is read again only when the ref moves", () => {
  const t = setup({ steps: [] });
  const log = join(t.dir, "git.log");
  const shim = join(t.dir, "shim");
  mkdirSync(shim);
  writeFileSync(join(shim, "git"), `#!/bin/sh\necho "$*" >> "${log}"\nexec ${Bun.which("git")} "$@"\n`);
  chmodSync(join(shim, "git"), 0o755);
  // a child process, because a spawn in this one does not see a changed PATH
  const script = `import { realWorld } from ${JSON.stringify(WORLD)};
    const world = realWorld(process.env);
    world.main(${JSON.stringify(t.repo)});
    world.newTick?.();
    world.main(${JSON.stringify(t.repo)});`;
  Bun.spawnSync([process.execPath, "-e", script], { env: { ...t.env, PATH: `${shim}:${process.env.PATH}` } });
  const logs = existsSync(log)
    ? readFileSync(log, "utf8")
        .split("\n")
        .filter((l) => / log /.test(l))
    : [];
  expect(logs.length).toBe(1);
});
