import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homeData } from "../src/home-data.ts";
import { roadmapData } from "../src/roadmap-view.ts";
import { status } from "../src/status.ts";
import { tmp } from "./helpers.ts";

const git = (cwd: string, ...a: string[]) => Bun.spawnSync(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { stdout: "pipe" });

/** Two tasks of one project; both last said "Waits for your reply". The fake `shepherdr task list` says AL-1 works and AL-2 needs you. */
function world() {
  const root = tmp("amber");
  const dir = join(root, "shepherdr");
  mkdirSync(join(dir, "chatlog"), { recursive: true });
  const path = join(root, "alpha");
  mkdirSync(join(path, "docs"), { recursive: true });
  const step = (id: string) => `### ${id} Step ${id}\n- why: w\n- done when: d\n- locks: ${id}\n- after: none\n\n`;
  writeFileSync(join(path, "docs", "ROADMAP.md"), `# Roadmap\n\n## One\n\n${step("S1")}${step("S2")}`);
  git(path, "init", "-b", "main");
  git(path, "commit", "--allow-empty", "-m", "first");
  writeFileSync(join(dir, "spaces.json"), JSON.stringify([{ name: "alpha", key: "AL", path }]));
  writeFileSync(
    join(dir, "tasks.json"),
    JSON.stringify({
      tasks: [
        { id: "AL-1", title: "S1 Step S1", told: "need", created: 1 },
        { id: "AL-2", title: "S2 Step S2", told: "work", created: 2 },
      ],
    }),
  );
  for (const id of ["AL-1", "AL-2"]) {
    const text = id === "AL-1" ? "Waits for your reply" : "Merge it?";
    writeFileSync(join(dir, "chatlog", `${id}_Agent.json`), JSON.stringify({ posted: [{ at: 9, card: { task: id, status: "need", text } }] }));
  }
  const config = join(root, "config");
  mkdirSync(join(config, "projects", "alpha"), { recursive: true });
  writeFileSync(join(config, "projects", "alpha", "settings.json"), JSON.stringify({ repo: path, space: "alpha" }));
  writeFileSync(join(config, "projects", "alpha", "state.json"), JSON.stringify({ taskSteps: { "AL-1": "S1", "AL-2": "S2" } }));
  const listed = [
    { id: "AL-1", title: "S1 Step S1", status: "work" },
    { id: "AL-2", title: "S2 Step S2", status: "need", sub: "Merge it?" },
  ];
  const bin = join(root, "task-list.sh");
  writeFileSync(bin, `#!/bin/sh\necho '${JSON.stringify(listed)}'\n`, { mode: 0o755 });
  const vars = { LINECLEAR_SHEPHERDR_DIR: dir, PI_CODING_AGENT_DIR: join(root, "pi"), LINECLEAR_CONFIG: config, SHEPHERDR_BIN: bin };
  return { vars, listed };
}

test("a task at work after a 'Waits for your reply' card is at work; one that waits is amber with its card's text", () => {
  const { vars, listed } = world();
  const now = Date.parse("2026-10-31T12:00:00Z");

  const home = homeData(vars, now).projects[0]?.tasks.map((t) => [t.id, t.state, t.text]);
  expect(home).toContainEqual(["AL-1", "work", undefined]);
  expect(home).toContainEqual(["AL-2", "need", "Merge it?"]);

  const view = roadmapData("alpha", vars, () => listed, now);
  if (!("ok" in view)) throw new Error("no roadmap data");
  expect(view.ok.steps.map((s) => [s.id, s.task?.status])).toEqual([
    ["S1", "work"],
    ["S2", "need"],
  ]);

  const lines: string[] = [];
  status((l) => lines.push(l), vars, "alpha");
  const said = lines.join("\n");
  expect(said).toContain("AL-2 waits for you: Merge it?");
  expect(said).not.toContain("AL-1");
});
