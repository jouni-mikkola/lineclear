import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machineMain } from "../src/machines.ts";
import { readMachines } from "../src/machine-list.ts";
import { originWithClone, script } from "./fakes.ts";

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

/**
 * A machine whose SSH shell has a bare PATH (no ~/.bun/bin, no ~/.local/bin), with no project repo and old Lineclear
 * leftovers. Its `lineclear` works only when the caller puts those folders on the PATH itself.
 */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "lc-add-"));
  temps.push(dir);
  const { origin, repo } = originWithClone(dir, { a: "a" });

  const config = join(dir, "config");
  const project = join(config, "projects", "webshop");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "settings.json"), JSON.stringify({ repo, space: "webshop", check: "true", models: { worker: [], reviewer: [], planner: [] } }));

  const home = join(dir, "remote-home");
  const log = join(dir, "remote.log");
  const needBun = `case ":$PATH:" in *":$HOME/.bun/bin:"*) ;; *) echo "env: 'bun': No such file or directory" >&2; exit 127 ;; esac`;
  script(
    join(home, ".local", "bin", "lineclear"),
    `${needBun}
echo "lineclear $*" >> "${log}"
case "$*" in
  doctor) echo "ok     skills" ;;
esac`,
  );
  // the remote shell: a bare PATH, as a non-interactive SSH login has
  const ssh = join(dir, "ssh");
  script(
    ssh,
    `while [ "$1" != "--" ]; do shift; done
c="$3"
case "$c" in *"sh -s") cat >/dev/null; echo "install ran" >> "${log}"; exit 0 ;; esac
HOME="${home}" PATH=/usr/bin:/bin exec sh -c "$c"`,
  );
  const env = { ...process.env, LINECLEAR_CONFIG: config, LINECLEAR_SSH: ssh, HOME: dir };
  return { home, log, env, origin };
}

test("a machine with a bare PATH and no repos ends ready, with the repos cloned ", async () => {
  const t = setup();
  const out: string[] = [];
  expect(await machineMain(["add", "desktop"], (l) => out.push(l), t.env)).toBe(0);
  expect(readMachines(t.env)).toMatchObject([{ host: "desktop", state: "ready" }]);
  expect(existsSync(join(t.home, "code", "webshop", ".git"))).toBe(true);
  expect(
    Bun.spawnSync(["git", "-C", join(t.home, "code", "webshop"), "remote", "get-url", "origin"])
      .stdout.toString()
      .trim(),
  ).toBe(t.origin);
  expect(out.at(-1)).toBe("desktop is ready: doctor passed there.");
});

test("a repo that cannot be cloned leaves the machine failed, with why", async () => {
  const t = setup();
  rmSync(t.origin, { recursive: true, force: true });
  expect(await machineMain(["add", "desktop"], () => {}, t.env)).toBe(1);
  expect(readMachines(t.env)[0]).toMatchObject({ state: "failed" });
  expect(readMachines(t.env)[0]?.doctor?.[0]).toContain("FAILED repo of webshop");
});
