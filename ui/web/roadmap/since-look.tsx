import { useEffect, useState } from "react";
import type { RoadmapData, RoadmapStep } from "../../../src/roadmap-view.ts";
import { Part } from "../../kit/index.ts";
import { roadmapPath } from "../routes.ts";
import { Label, needsYou } from "./common.tsx";

// Since you last looked: merges, starts and new waits for you, against a note the browser keeps of the last look.

export interface Look {
  at: number;
  /** Per step: "done", "work" or "need" (at work and waiting for you), else "". */
  seen: Record<string, string>;
}

export interface Changes {
  merged: RoadmapStep[];
  started: RoadmapStep[];
  waits: RoadmapStep[];
}

const mark = (s: RoadmapStep) => (s.state === "done" ? "done" : needsYou(s) ? "need" : s.state === "work" ? "work" : "");

export const takeLook = (d: RoadmapData, now: number): Look => ({ at: now, seen: Object.fromEntries(d.steps.map((s) => [s.id, mark(s)])) });

/** The steps merged after the last look (git's time), started since it, or newly waiting for you. */
export function changesSince(d: RoadmapData, look: Look): Changes {
  const mergedAt = new Map(d.history.map((h) => [h.step, h.at]));
  const merged = d.steps.filter((s) => s.state === "done" && (mergedAt.get(s.id) ?? 0) > look.at);
  const rest = d.steps.filter((s) => !merged.includes(s));
  const was = (s: RoadmapStep) => look.seen[s.id] ?? "";
  return {
    merged,
    started: rest.filter((s) => mark(s) === "work" && was(s) === ""),
    waits: rest.filter((s) => mark(s) === "need" && was(s) !== "need"),
  };
}

const key = (project: string) => `lineclear:roadmap-look:${project}`;

function readLook(project: string): Look | undefined {
  try {
    return JSON.parse(localStorage.getItem(key(project)) ?? "null") ?? undefined;
  } catch {
    return undefined;
  }
}

/** Shows the changes since the last look, and keeps this look for the next visit when the page is left. */
export function SinceLook({ d }: { d: RoadmapData }) {
  // read once, when the page opens: what changes while you look is not "since"
  const [look] = useState(() => readLook(d.project));
  useEffect(() => {
    const save = () => localStorage.setItem(key(d.project), JSON.stringify(takeLook(d, Date.now())));
    save();
    return save;
  }, [d]);
  if (!look) return null;
  const c = changesSince(d, look);
  const groups: [string, RoadmapStep[]][] = [
    ["Merged", c.merged],
    ["Started", c.started],
    ["Waits for you", c.waits],
  ];
  const total = c.merged.length + c.started.length + c.waits.length;
  return (
    <section className="mt-8" aria-label="Since you last looked" data-since-look>
      <Label>Since you last looked</Label>
      <Part state={total ? "filled" : "empty"} label="Since you last looked" empty={{ text: "Nothing new since you last looked." }}>
        <div className="space-y-3 rounded-lg bg-raised/60 p-4">
          {groups.map(([name, steps]) =>
            steps.length ? (
              <div key={name} data-since-group={name}>
                <h3 className="text-sm text-fg3">{name}</h3>
                <ul className="mt-1 space-y-1">
                  {steps.map((s) => (
                    <li key={s.id} className="min-w-0 truncate text-sm">
                      <a href={roadmapPath(d.project, s.id)} className="text-fg hover:underline" data-since-step={s.id}>
                        <span className="font-semibold tabular-nums text-fg2">{s.id}</span> {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </div>
      </Part>
    </section>
  );
}
