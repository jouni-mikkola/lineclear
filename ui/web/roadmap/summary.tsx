import { useEffect, useState } from "react";
import type { RoadmapLine } from "../../../src/roadmap-line.ts";
import { sampleState, send } from "../data.ts";
import { roadmapPath } from "../routes.ts";

/** The one switch of a project: Running (the rules start its next steps) or Paused (they start none). It moves at once and goes back, with the server's reason, when the change fails. */
export function RunSwitch({ project, paused }: { project: string; paused: boolean }) {
  const [mine, setMine] = useState<boolean | undefined>();
  const [error, setError] = useState<string | undefined>();
  const now = mine ?? paused;
  // the server's word wins again once it changes, such as a `lineclear project set --paused`
  useEffect(() => setMine(undefined), [paused]);
  const flip = async () => {
    setMine(!now);
    setError(undefined);
    if (sampleState()) return;
    const failed = await send(`/api/projects/${encodeURIComponent(project)}`, { paused: !now });
    if (failed) {
      setMine(undefined);
      setError(failed);
    }
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 text-sm" data-run-switch>
      <button
        type="button"
        role="switch"
        aria-checked={!now}
        aria-label={`${project} runs its next steps`}
        onClick={() => void flip()}
        className="inline-flex min-h-10 items-center gap-2 rounded-sm border border-line px-3 text-fg hover:bg-raised3 focus-visible:outline-2 focus-visible:outline-accent"
        data-run-state={now ? "paused" : "running"}
      >
        <span aria-hidden className={`size-2 rounded-full ${now ? "bg-caution" : "bg-clear"}`} />
        {now ? "Paused" : "Running"}
      </button>
      {error && (
        <span role="alert" className="break-words text-fg2">
          {error}
        </span>
      )}
    </div>
  );
}

/** How far the roadmap is in all, when it ends and what keeps the end from coming sooner: one plain line at the top.
 *  With a critical path, a tap opens its first step, whose page draws the chain. */
export function LineOfRoadmap({ line, project }: { line: RoadmapLine; project: string }) {
  const head = line.path?.[0];
  const text = (
    <p className="break-words text-sm text-fg2 [overflow-wrap:anywhere]" data-roadmap-line>
      {line.text}
    </p>
  );
  const details = line.detail && (
    <details className="mt-1 text-sm text-fg3" data-roadmap-detail>
      <summary className="min-h-8 cursor-pointer hover:text-fg2">Details</summary>
      <p className="break-words [overflow-wrap:anywhere]">{line.detail}</p>
    </details>
  );
  const link = head ? (
    <a
      href={roadmapPath(project, head)}
      className="flex min-h-12 items-center py-2 hover:text-fg"
      aria-label={`${line.text} Opens the critical path.`}
      data-critical-path-link
    >
      {text}
    </a>
  ) : (
    text
  );
  return (
    <div className="mb-4">
      {link}
      {details}
    </div>
  );
}
