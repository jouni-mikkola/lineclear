import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorChecks, type Probe } from "../src/doctor.ts";
import { pathsFor } from "../src/paths.ts";
import { pushSecrets, syncSecretsIfChanged } from "../src/secret-sync.ts";
import { secretFolderNames, secrets } from "../src/secrets.ts";
import { script } from "./fakes.ts";

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

/** A server folder with a login secrets folder, and a remote home reached through a fake ssh that runs the command there. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), "lc-secsync-"));
  temps.push(dir);
  const folder = join(dir, "server-secrets");
  mkdirSync(join(folder, "machine"), { recursive: true });
  writeFileSync(join(folder, "common.env"), "M365_GA_TOTP='JBSWY3DPEHPK3PXP'\nGITHUB_TOKEN='ghp_x'\n");
  writeFileSync(join(folder, "machine", "sudo.env"), "SUDO_PASSWORD='hunter2'\n");
  const home = join(dir, "remote-home");
  mkdirSync(home);
  const ssh = join(dir, "ssh");
  script(
    ssh,
    `while [ $# -gt 0 ]; do case "$1" in -o) shift 2 ;; --) shift ;; *) break ;; esac; done
shift
cd "${home}" || exit 1
export HOME="${home}"
if [ $# -eq 1 ]; then exec sh -c "$1"; else exec "$@"; fi`,
  );
  const env = { ...process.env, HOME: dir, LINECLEAR_SSH: ssh, LINECLEAR_SECRETS_FOLDER: folder };
  return { dir, folder, home, env, remote: join(home, ".config", "control-center", "secrets") };
}

const mode = (f: string) => (statSync(f).mode & 0o777).toString(8);

test("the folder is copied over SSH with 0600 files and 0700 folders, and the output holds no value", async () => {
  const w = world();
  chmodSync(join(w.folder, "common.env"), 0o644);
  expect(await pushSecrets("desktop", w.env)).toBeUndefined();
  expect(readFileSync(join(w.remote, "common.env"), "utf8")).toContain("M365_GA_TOTP");
  expect(readFileSync(join(w.remote, "machine", "sudo.env"), "utf8")).toContain("SUDO_PASSWORD");
  expect([mode(w.remote), mode(join(w.remote, "machine")), mode(join(w.remote, "common.env"))]).toEqual(["700", "700", "600"]);
  // a file left loose by an earlier copy is tightened too
  chmodSync(join(w.remote, "common.env"), 0o644);
  chmodSync(join(w.remote, "machine"), 0o775);
  writeFileSync(join(w.folder, "common.env"), "M365_GA_TOTP='JBSWY3DPEHPK3PXP'\nGITHUB_TOKEN='ghp_y'\n");
  expect(await pushSecrets("desktop", w.env)).toBeUndefined();
  expect([mode(join(w.remote, "machine")), mode(join(w.remote, "common.env"))]).toEqual(["700", "600"]);
  const failed = await pushSecrets("desktop", { ...w.env, LINECLEAR_SSH: "/nonexistent/ssh" });
  expect(failed).toBeDefined();
  expect(failed).not.toContain("hunter2");
});

test("the newer file wins and nothing is deleted", async () => {
  const w = world();
  await pushSecrets("desktop", w.env);
  const there = join(w.remote, "common.env");
  writeFileSync(there, "M365_GA_TOTP='newer'\n");
  utimesSync(there, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
  writeFileSync(join(w.remote, "only-there.env"), "KEEP='1'\n");
  await pushSecrets("desktop", w.env);
  expect(readFileSync(there, "utf8")).toContain("newer");
  expect(readFileSync(join(w.remote, "only-there.env"), "utf8")).toContain("KEEP");
});

test("a change in the folder on the server is sent again, an unchanged one is not", async () => {
  const w = world();
  const host = "desktop-sync";
  await syncSecretsIfChanged([host], w.env);
  const arrived = join(w.remote, "common.env");
  expect(readFileSync(arrived, "utf8")).toContain("M365_GA_TOTP");
  rmSync(arrived);
  await syncSecretsIfChanged([host], w.env);
  expect(() => statSync(arrived)).toThrow();
  writeFileSync(join(w.folder, "common.env"), "M365_GA_TOTP='JBSWY3DPEHPK3PXP'\nNEW_NAME='v'\n");
  await syncSecretsIfChanged([host], w.env);
  expect(readFileSync(arrived, "utf8")).toContain("NEW_NAME");
});

test("secrets names prints names only", async () => {
  const w = world();
  const lines: string[] = [];
  expect(await secrets(["names"], (l) => lines.push(l), w.env)).toBe(0);
  expect(lines).toEqual(["GITHUB_TOKEN", "M365_GA_TOTP", "SUDO_PASSWORD"]);
  expect(secretFolderNames({ ...w.env, LINECLEAR_SECRETS_FOLDER: join(w.dir, "none") })).toEqual([]);
});

test("doctor fails for a machine that lacks a secret name the server has, and names only the names", () => {
  const probe = (names: string[] | null): Probe => ({
    oldDir: "/nonexistent-old",
    paths: pathsFor({ HOME: "/nonexistent-home" }),
    pathDirs: [],
    which: (c) => `/usr/bin/${c}`,
    run: () => null,
    secrets: { here: ["GITHUB_TOKEN", "M365_GA_TOTP"], others: [{ host: "desktop", names }] },
  });
  const check = (names: string[] | null) => doctorChecks(probe(names)).find((c) => c.name === "secrets on desktop");
  expect(check(["GITHUB_TOKEN", "M365_GA_TOTP", "EXTRA"])?.problem).toBe("");
  const bad = check(["GITHUB_TOKEN"]);
  expect(bad?.problem).toContain("M365_GA_TOTP");
  expect(bad?.fix).toBe("lineclear machine update desktop");
  expect(check(null)?.problem).toContain("cannot be read");
});
