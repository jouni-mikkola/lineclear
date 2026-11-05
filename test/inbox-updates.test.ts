import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { addItem, closeSettledUpdates, isOpen, readItems } from "../src/inbox.ts";
import { tmp } from "./helpers.ts";

const git = (cwd: string, ...a: string[]) =>
  Bun.spawnSync(["git", "-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...a])
    .stdout.toString()
    .trim();

/** A machine whose installed app has three commits; the notice names one of them. */
function machine() {
  const root = tmp("updates");
  const vars = { ...process.env, HOME: root, XDG_DATA_HOME: undefined, LINECLEAR_CONFIG: join(root, "config") } as NodeJS.ProcessEnv;
  const app = join(root, ".local", "share", "lineclear");
  mkdirSync(app, { recursive: true });
  git(app, "init", "-q", "-b", "main");
  const commit = (m: string) => {
    git(app, "commit", "-q", "--allow-empty", "-m", m);
    return git(app, "rev-parse", "--short", "HEAD");
  };
  const [first = "", , last = ""] = ["a", "b", "c"].map(commit);
  const notice = (sha: string, task = "-") =>
    addItem(
      {
        kind: "stuck",
        task,
        question: `The update to ${sha} failed: the test track broke. Putting 0000000 back.`,
        choices: ["Ok"],
        since: "2099-01-01T00:00:00Z",
      },
      vars,
    );
  return { vars, app, first, last, notice };
}

test("an update notice closes once the machine runs that commit", () => {
  const m = machine();
  m.notice(m.last);
  expect(closeSettledUpdates(new Date(), m.vars)).toHaveLength(1);
  expect(readItems(m.vars).filter(isOpen)).toHaveLength(0);
});

test("an update notice closes when the machine runs a newer commit", () => {
  const m = machine();
  m.notice(m.first);
  closeSettledUpdates(new Date(), m.vars);
  expect(readItems(m.vars)[0]?.closed).toContain("or a newer version");
});

test("a notice stays while the machine is on the version before the update", () => {
  const m = machine();
  git(m.app, "checkout", "-q", "--detach", m.first);
  m.notice(m.last);
  expect(closeSettledUpdates(new Date(), m.vars)).toEqual([]);
  expect(readItems(m.vars).filter(isOpen)).toHaveLength(1);
});

test("a commit the machine does not know, and other items, stay open", () => {
  const m = machine();
  m.notice("deadbee");
  m.notice(m.first, "LIN-5");
  addItem({ kind: "stuck", task: "-", question: "Main is red", choices: ["Ok"], since: "2099-01-01T00:00:00Z" }, m.vars);
  expect(closeSettledUpdates(new Date(), m.vars)).toEqual([]);
  expect(readItems(m.vars).filter(isOpen)).toHaveLength(3);
});

test("a shallow install, with no history behind HEAD, closes a notice made before its commit", () => {
  const m = machine();
  const dir = join(tmp("shallow"), "app");
  Bun.spawnSync(["git", "clone", "-q", "--depth", "1", `file://${m.app}`, dir]);
  const vars = { ...m.vars, XDG_DATA_HOME: join(dir, "..") };
  Bun.spawnSync(["mv", dir, join(dir, "..", "lineclear")]);
  addItem(
    { kind: "stuck", task: "-", question: "The update to 1234567 failed: x. Putting 0000000 back.", choices: ["Ok"], since: "2020-01-01T00:00:00Z" },
    vars,
  );
  expect(closeSettledUpdates(new Date(), vars)).toHaveLength(1);
});

test("a shallow install on the old version keeps a notice made after its commit", () => {
  const m = machine();
  addItem(
    { kind: "stuck", task: "-", question: "The update to 1234567 failed: x. Putting 0000000 back.", choices: ["Ok"], since: "2099-01-01T00:00:00Z" },
    m.vars,
  );
  expect(closeSettledUpdates(new Date(), m.vars)).toEqual([]);
});
