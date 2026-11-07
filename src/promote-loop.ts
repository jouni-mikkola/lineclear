import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Settings } from "./project.ts";
import type { Decision, State } from "./rules.ts";
import type { World } from "./world.ts";

const EVERY_MS = 30 * 60_000;
const LOOK_BACK = 10;

/** Ticks this process has finished: the first tick of a build only proves the loop runs on it. */
let ticksDone = 0;

/**
 * Promotes the newest of main's last commits whose `check` is green, with scripts/promote.ts, which refuses a red or
 * pending one. It tries at most once in 30 minutes and never while a merge runs, so main is installed from only when
 * it is quiet. A freshly started loop (a new build after an update) ticks once before it promotes. Only Lineclear's own repo is promoted: another project has no scripts/promote.ts.
 */
export function promoteGreen(name: string, settings: Settings, world: World, state: State, dryRun: boolean): Decision[] {
  if (dryRun) return [];
  if (ticksDone++ === 0) return [];
  if (!world.recentMain || !world.promote || settings.paused || !existsSync(join(settings.repo, "scripts", "promote.ts"))) return [];
  const now = world.now().getTime();
  if (state.promote && now - state.promote.at < EVERY_MS) return [];
  const tasks = world.tasks(settings.space);
  if (typeof tasks === "string" || tasks.some((t) => t.status === "merging")) return [];
  const note = (reason: string): Decision[] => [{ time: world.now().toISOString(), project: name, kind: "run", reason }];
  const heads = world.recentMain(settings.repo, LOOK_BACK);
  const last = state.promote?.commit;
  state.promote = { at: now, commit: last };
  for (const commit of heads) {
    if (commit === last) return [];
    const result = world.promote(settings.repo, commit);
    if (result === "refused") continue;
    if (result !== "promoted") return note(`promoting ${commit.slice(0, 10)} failed: ${result}`);
    state.promote = { at: now, commit };
    return note(`promoted ${commit.slice(0, 10)}, the newest commit of main with a green check`);
  }
  return [];
}
