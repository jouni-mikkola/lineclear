import { isFrozen, type State } from "./roadmap.ts";

// Where the next release stands, for the owner: read from docs/release.md (its parts and checks) and the roadmap's step
// states. `lineclear release` and the web Roadmap view draw the same object.

/** A step as the release view reads it: a RoadmapStep fits. */
type ReleaseStep = { id: string; title: string; result: string; phase: string; state: State };

/** `holds` and `fails` come from the check's Today cell; a check with none, or one that says "not measured", is unmeasured. */
type CheckState = "holds" | "fails" | "unmeasured";

export interface ReleaseCheck {
  id: string;
  /** The part it belongs to, as its section of release.md names it. */
  part: string;
  must: string;
  state: CheckState;
  /** Today's number, as the Today cell writes it. */
  today?: string;
}

export interface ReleaseView {
  /** As release.md's heading names it, such as "v0.2". */
  version: string;
  /** One per part, in rank order: the steps of the roadmap's phases tagged with its rank, done and in all. */
  parts: { rank: string; name: string; done: number; total: number }[];
  /** The steps of phases with no rank, which count toward no part. */
  unranked: { done: number; total: number };
  checks: ReleaseCheck[];
  /** The first steps at work and the first that wait, in the roadmap's order. */
  now: ReleaseStep[];
  next: ReleaseStep[];
}

/** How a check stands, in the words the CLI and the view both show. */
export const checkWord = (c: ReleaseCheck): string =>
  c.state === "holds" ? "holds" : c.state === "unmeasured" ? "not measured yet" : `fails${c.today ? `: today ${c.today}` : ""}`;

const SHOWN = 5;
const RANK = /\((P\d+)\)\s*$/;

/** The cells of a markdown table row, without the outer pipes. */
const cells = (line: string) =>
  line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());

function checkState(today: string | undefined): Pick<ReleaseCheck, "state" | "today"> {
  if (today === undefined || today === "" || /^not measured\b/i.test(today)) return { state: "unmeasured", ...(today ? { today } : {}) };
  const held = /^holds\b[:,;]?\s*(.*)$/i.exec(today);
  if (held) return { state: "holds", ...(held[1] ? { today: held[1] } : {}) };
  return { state: "fails", today };
}

/** The parts and checks of release.md's "The checks": each `### P<n>: <name>` a part, each `| R<n> |` row a check. */
function readChecks(text: string): { parts: { rank: string; name: string }[]; checks: ReleaseCheck[] } {
  const parts: { rank: string; name: string }[] = [];
  const checks: ReleaseCheck[] = [];
  let inChecks = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) inChecks = line.trim() === "## The checks";
    if (!inChecks) continue;
    const part = /^### (P\d+): (.+)$/.exec(line);
    if (part) parts.push({ rank: part[1] as string, name: (part[2] as string).trim() });
    const row = cells(line);
    if (!/^R\d+$/.test(row[0] ?? "") || parts.length === 0) continue;
    const [id = "", must = "", , today] = row;
    checks.push({ id, part: parts.at(-1)?.name ?? "", must, ...checkState(today) });
  }
  return { parts, checks };
}

/** Where the release of `releaseText` stands with these steps; undefined when the text names no version or no checks. */
export function releaseView(releaseText: string, steps: ReleaseStep[]): ReleaseView | undefined {
  const version = /^# Release (\S+)/m.exec(releaseText)?.[1];
  const { parts, checks } = readChecks(releaseText);
  if (version === undefined || checks.length === 0) return undefined;
  const live = steps.filter((s) => s.state !== "dropped" && !isFrozen(s));
  const count = (of: ReleaseStep[]) => ({ done: of.filter((s) => s.state === "done").length, total: of.length });
  const rankOf = (s: ReleaseStep) => RANK.exec(s.phase)?.[1];
  const ranks = new Set(parts.map((p) => p.rank));
  return {
    version,
    parts: parts.map((p) => ({ ...p, ...count(live.filter((s) => rankOf(s) === p.rank)) })),
    unranked: count(live.filter((s) => !ranks.has(rankOf(s) ?? ""))),
    checks,
    now: live.filter((s) => s.state === "work").slice(0, SHOWN),
    next: [...live.filter((s) => s.state === "ready"), ...live.filter((s) => s.state === "waiting")].slice(0, SHOWN),
  };
}
