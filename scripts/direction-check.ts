// The direction check: docs/idea.md has "The owner's direction", and each task id it names should be a task that is done
// (merged on main) or open (in the task list); one in neither is said, so no line is dropped silently.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { directionOf, taskIds } from "../src/direction.ts";
import { dataDir } from "../src/paths.ts";

const root = process.argv[2] ?? ".";
const section = directionOf(readFileSync(join(root, "docs", "idea.md"), "utf8"));
if (section === undefined) {
  console.error(`direction check: docs/idea.md has no "## The owner's direction" section`);
  process.exit(1);
}

const merged = Bun.spawnSync(["git", "-C", root, "log", "--format=%s"], { stdin: "ignore" }).stdout.toString();
const known = new Set(taskIds(merged));
const list = join(dataDir(process.env), "tasks.json");
const tracked = existsSync(list);
if (tracked) {
  const tasks = JSON.parse(readFileSync(list, "utf8"))?.tasks ?? [];
  for (const t of Array.isArray(tasks) ? tasks : Object.values<{ id?: unknown }>(tasks)) if (typeof t?.id === "string") known.add(t.id);
}

const ids = taskIds(section);
if (ids.length === 0) {
  console.error("direction check: the section names no task");
  process.exit(1);
}
// The task list holds the open tasks only, and a task that ended with nothing to merge leaves no commit: an id in neither
// is said, not failed, or the first such task would turn every merge red on a machine whose list was cleaned.
const missing = tracked ? ids.filter((id) => !known.has(id)) : [];
for (const id of missing) console.warn(`direction check: ${id} is neither merged nor in the task list (it may have ended with nothing to merge)`);
