import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ownerDirection } from "./direction.ts";

/** The Dispatcher's instructions for one plan, from `templates/plan.md`, with the direction of `repo`, else the general one. */
export function planBrief(project: string, goal: string, repo: string | undefined, id: string): string {
  const text = readFileSync(join(import.meta.dir, "..", "templates", "plan.md"), "utf8");
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => ({ project, goal, id, repo: repo ?? "", direction: ownerDirection(repo) })[k] ?? "");
}
