import { OLD_NAME } from "../src/old-install.ts";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyBrowsers, oldPathRecords, rewriteOldPaths } from "../src/old-paths.ts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "oldpaths-"));
  const r = { old: join(dir, `.${OLD_NAME}`), now: join(dir, ".lineclear"), app: join(dir, "app") };
  mkdirSync(r.old, { recursive: true });
  mkdirSync(r.now, { recursive: true });
  const checkout = join(dir, ".config/herdr/plugins/github-installations/herdr-projects-b1278ffb803c/1408050-0/checkout");
  writeFileSync(
    join(r.now, "agents.json"),
    JSON.stringify({
      "LIN-1/Agent": {
        key: "LIN-1/Agent",
        cwd: "/work/lin-1",
        system: `Read ${checkout}/skill/${OLD_NAME}/SKILL.md first`,
        env: { AGENT_BROWSER_PROFILE: `${r.old}/browser/LIN-1`, PATH: `${checkout}/bin:/usr/bin` },
        logs: [join(r.old, "chatlog", "LIN-1.jsonl")],
      },
    }),
  );
  writeFileSync(
    join(r.now, "tasks.json"),
    JSON.stringify({ tasks: [{ id: "LIN-1", worktree: "/work/lin-1", desc: `prose about ${r.old}/x stays`, log: `${r.old}/chatlog/LIN-1.jsonl` }] }),
  );
  return { r, checkout };
}

test("doctor --fix rewrites old paths in agents.json and tasks.json, and the task still opens its chat", () => {
  const { r } = setup();
  mkdirSync(join(r.now, "chatlog"), { recursive: true });
  writeFileSync(join(r.now, "chatlog", "LIN-1.jsonl"), '{"text":"hello"}\n');
  // a file the old folder had and was never copied keeps its place
  writeFileSync(
    join(r.now, "tasks.json"),
    JSON.stringify({
      tasks: [
        {
          id: "LIN-1",
          worktree: "/work/lin-1",
          desc: `prose about ${r.old}/x stays`,
          log: `${r.old}/chatlog/LIN-1.jsonl`,
          lost: `${r.old}/chatlog/none.jsonl`,
        },
      ],
    }),
  );
  expect(oldPathRecords(r)).toContain("agents.json and tasks.json");
  expect(rewriteOldPaths(r)).toEqual(["agents.json", "tasks.json"]);
  expect(oldPathRecords(r)).toBe("");

  const agent = JSON.parse(readFileSync(join(r.now, "agents.json"), "utf8"))["LIN-1/Agent"];
  expect(agent.env.AGENT_BROWSER_PROFILE).toBe(join(r.now, "browser", "LIN-1"));
  expect(agent.env.PATH).toBe(`${join(r.now, "helper", "bin")}:/usr/bin`);
  expect(agent.system).toBe(`Read ${join(r.app, "server")}/skill/${OLD_NAME}/SKILL.md first`);
  const task = JSON.parse(readFileSync(join(r.now, "tasks.json"), "utf8")).tasks[0];
  expect(task.log).toBe(join(r.now, "chatlog", "LIN-1.jsonl"));
  expect(task.lost).toBe(`${r.old}/chatlog/none.jsonl`);
  expect(task.desc).toContain(`${r.old}/x`);
  // the chat the rewritten records name is there to open
  expect(readFileSync(agent.logs[0], "utf8")).toContain("hello");
  expect(readFileSync(task.log, "utf8")).toContain("hello");
});

test("browser profiles are copied, not moved, and one in use is left", () => {
  const { r } = setup();
  for (const t of ["A-1", "A-2", "A-3"]) mkdirSync(join(r.old, "browser", t), { recursive: true });
  mkdirSync(join(r.now, "browser", "A-3"), { recursive: true });
  const now = Date.now();
  writeFileSync(join(r.old, "browser", "A-2.used"), "");
  utimesSync(join(r.old, "browser", "A-2.used"), new Date(now - 60_000), new Date(now - 60_000));
  expect(copyBrowsers(r, now)).toEqual(["A-1"]);
  expect(existsSync(join(r.now, "browser", "A-1"))).toBe(true);
  expect(existsSync(join(r.old, "browser", "A-1"))).toBe(true);
  expect(existsSync(join(r.now, "browser", "A-2"))).toBe(false);
});
