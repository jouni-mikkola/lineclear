import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backupDue, backupMain, backupProblem, KEEP } from "../src/backup.ts";
import { secrets } from "../src/secrets.ts";
import { tmp } from "./helpers.ts";

let root: string;
let env: Record<string, string | undefined>;
const config = () => join(root, "config");
const data = () => join(root, "data");

beforeEach(async () => {
  root = tmp("backup");
  env = {
    PATH: process.env.PATH,
    HOME: root,
    LINECLEAR_CONFIG: join(root, "config"),
    LINECLEAR_HOME: join(root, "data"),
    LINECLEAR_MAIN_HOME: join(root, "data"),
    LINECLEAR_MACHINE: "box1",
  };
  mkdirSync(join(data(), "browser"), { recursive: true });
  mkdirSync(join(data(), "chatlog"), { recursive: true });
  mkdirSync(config(), { recursive: true });
  writeFileSync(join(data(), "tasks.json"), '{"tasks":1}');
  writeFileSync(join(data(), "chatlog", "a.jsonl"), "hello\n");
  writeFileSync(join(data(), "browser", "profile"), "remade on use");
  writeFileSync(join(root, "extra.txt"), "a key");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const settings = (repos: unknown[], paths: string[] = []) => writeFileSync(join(config(), "backup.json"), JSON.stringify({ repos, paths }));
const password = () =>
  secrets(
    ["set", "--owner", "LINECLEAR_BACKUP_PASSWORD"],
    () => {},
    env,
    async () => "pw\n",
  );
const run = (args: string[] = []) => {
  const out: string[] = [];
  return { code: backupMain(args, (l) => out.push(l), env), out: out.join("\n") };
};
const state = () => JSON.parse(readFileSync(join(config(), "backup-state.json"), "utf8"));

test("with no repository it says what to write, and doctor sees no problem", () => {
  const r = run();
  expect(r.code).toBe(1);
  expect(r.out).toContain("backup.json");
  expect(backupProblem(env)).toBe("");
  expect(backupDue(env)).toBe(false);
  expect(run(["status"]).out).toContain("no backup");
});

test("without the password it names the secret and how to set it", () => {
  settings([join(root, "repo")]);
  const r = run();
  expect(r.code).toBe(1);
  expect(r.out).toContain("LINECLEAR_BACKUP_PASSWORD is not set");
});

test.skipIf(!Bun.which("restic"))(
  "a backup to a local repository restores the same files, without what can be made again",
  async () => {
    settings([join(root, "repo")], ["~/extra.txt"]);
    await password();
    await secrets(
      ["set", "--all", "TOKEN"],
      () => {},
      env,
      async () => "t",
    );
    const r = run();
    expect(r.out).toContain("saved to");
    expect(r.code).toBe(0);
    expect(state().repos[join(root, "repo")].ok).toBe(true);
    expect(run(["status"]).out).toContain("last copy");
    const back = join(root, "back");
    expect(run(["restore", back]).code).toBe(0);
    expect(readFileSync(join(back, data(), "tasks.json"), "utf8")).toBe('{"tasks":1}');
    expect(readFileSync(join(back, data(), "chatlog", "a.jsonl"), "utf8")).toBe("hello\n");
    expect(readFileSync(join(back, root, "extra.txt"), "utf8")).toBe("a key");
    expect(existsSync(join(back, data(), "browser", "profile"))).toBe(false);
    expect(readFileSync(join(back, data(), "vault.json"), "utf8")).toContain("TOKEN");
    expect(existsSync(join(back, config(), "owner.env"))).toBe(true);
    const newDisk = { ...env, LINECLEAR_MACHINE: "box2" };
    const out: string[] = [];
    expect(backupMain(["restore", join(root, "back2")], (l) => out.push(l), newDisk)).toBe(1);
    expect(out.join("\n")).toContain("--from");
    expect(backupMain(["restore", join(root, "back2"), "--from", "box1"], () => {}, newDisk)).toBe(0);
    expect(readFileSync(join(root, "back2", data(), "tasks.json"), "utf8")).toBe('{"tasks":1}');
  },
  60_000,
);

test("an hour after a run the next one is due; a day without a good copy is a doctor problem", () => {
  settings([join(root, "repo")]);
  const at = Date.parse("2026-11-01T10:00:00Z");
  writeFileSync(
    join(config(), "backup-state.json"),
    JSON.stringify({
      repos: { [join(root, "repo")]: { ok: false, at: new Date(at).toISOString(), lastGood: new Date(at - 2 * 86_400_000).toISOString(), error: "no route" } },
    }),
  );
  expect(backupDue(env, new Date(at + 30 * 60_000))).toBe(false);
  expect(backupDue(env, new Date(at + 60 * 60_000))).toBe(true);
  expect(backupProblem(env, new Date(at))).toContain("no route");
  writeFileSync(
    join(config(), "backup-state.json"),
    JSON.stringify({ repos: { [join(root, "repo")]: { ok: true, at: new Date(at).toISOString(), lastGood: new Date(at).toISOString() } } }),
  );
  expect(backupProblem(env, new Date(at + 3_600_000))).toBe("");
});

test("it keeps hourly copies for two days and daily ones for a month, prunes once a day, and a failed repository keeps its last good copy", async () => {
  settings([join(root, "a"), join(root, "b")]);
  await password();
  const calls: string[][] = [];
  const restic = (repo: { repo: string }, args: string[]) => {
    calls.push([repo.repo, ...args]);
    if (repo.repo.endsWith("b") && args[0] === "backup") return { code: 1, out: "", err: "Fatal: unable to open repository at pw-free place" };
    return { code: 0, out: args[0] === "backup" ? '{"message_type":"summary","snapshot_id":"abcdef1234"}\n' : "", err: "" };
  };
  const once = (now: Date) => backupMain([], () => {}, env, restic, now);
  expect(once(new Date("2026-11-01T10:00:00Z"))).toBe(1);
  const forget = calls.filter((c) => c[1] === "forget");
  expect(forget[0]).toEqual([join(root, "a"), "forget", "--tag", "lineclear", "--host", "box1", ...KEEP, "--prune"]);
  expect(KEEP).toEqual(["--keep-hourly", "48", "--keep-daily", "30"]);
  expect(state().repos[join(root, "a")].snapshot).toBe("abcdef12");
  expect(state().repos[join(root, "b")].error).toContain("unable to open");
  expect(state().pruned).toBeUndefined(); // b failed, so the next run prunes again
  settings([join(root, "a")]);
  calls.length = 0;
  once(new Date("2026-11-01T11:00:00Z"));
  expect(calls.find((c) => c[1] === "forget")).toContain("--prune");
  calls.length = 0;
  once(new Date("2026-11-01T12:00:00Z"));
  expect(calls.find((c) => c[1] === "forget")).not.toContain("--prune");
});

test("a second run while one runs ends at once", async () => {
  settings([join(root, "repo")]);
  await password();
  writeFileSync(join(config(), "backup.lock"), "");
  expect(run()).toEqual({ code: 0, out: "lineclear backup: another backup runs now" });
});
