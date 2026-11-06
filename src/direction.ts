import { readFileSync } from "node:fs";
import { join } from "node:path";

const HEADING = "## The owner's direction";

/** The section of `docs/idea.md` that holds the owner's direction: its heading and lines, up to the next `## ` heading. */
function directionOf(idea: string): string | undefined {
  const start = idea.indexOf(`\n${HEADING}\n`);
  if (start < 0) return undefined;
  const from = start + 1;
  const next = idea.indexOf("\n## ", from + HEADING.length);
  return idea.slice(from, next < 0 ? undefined : next).trim();
}

/** The task ids a text names, each once, as `LIN-123`. */

/**
 * The owner's direction for work on a repo: the section of its own docs/idea.md, else the general one Lineclear ships.
 * Without a repo (the Dispatcher works for every project) it is the general one: one project's lines would steer the
 * others.
 */
export function ownerDirection(repo?: string): string {
  if (repo !== undefined) {
    try {
      const own = directionOf(readFileSync(join(repo, "docs", "idea.md"), "utf8"));
      if (own !== undefined) return own;
    } catch {
      // a repo without docs/idea.md takes the general direction
    }
  }
  return readFileSync(join(import.meta.dir, "..", "templates", "direction.md"), "utf8").trim();
}
