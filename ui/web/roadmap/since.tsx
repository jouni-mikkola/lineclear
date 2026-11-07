import { useState } from "react";
import type { RoadmapStep } from "../../../src/roadmap-view.ts";
import type { AppliedChange, PlanCard } from "../../../src/web.ts";
import { RoleIcon, StationPic } from "../../kit/index.ts";
import { queryClient, send, useApplied } from "../data.ts";
import { inboxPath } from "../routes.ts";
import { plural, StepPic, stateWord } from "./common.tsx";

const DISPATCHER = "dispatcher";

// What changed by itself, and the steps of your request.

/** Changes that applied by themselves once the rules and the readiness check said go. One tap reverts one; it is no approval. */
export function AppliedStrip({ project }: { project: string }) {
  const sample = new URLSearchParams(location.search).get("state") ?? undefined;
  const applied = useApplied(project, sample as never);
  const [busy, setBusy] = useState<number | undefined>();
  const [error, setError] = useState<string | undefined>();
  const list: AppliedChange[] = applied.status === "ok" ? applied.data : [];
  if (list.length === 0) return null;
  const undo = async (c: AppliedChange) => {
    setBusy(c.id);
    setError(await send(`/api/inbox/${c.id}/undo`, {}));
    setBusy(undefined);
    queryClient.invalidateQueries({ queryKey: ["applied", project] });
    queryClient.invalidateQueries({ queryKey: ["roadmap", project] });
  };
  return (
    <section className="mt-8 rounded-lg border border-line bg-raised/40 p-4 md:p-5" aria-label="Applied by itself" data-applied>
      <h2 className="text-sm font-medium text-fg2">Applied by itself</h2>
      <ul className="mt-2 space-y-2">
        {list.map((c) => (
          <li key={c.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm" data-applied-change={c.id}>
            <span className="min-w-0 break-words text-fg">
              {c.question}
              {c.steps.length > 0 && <span className="text-fg2"> ({plural(c.steps.length, "step")})</span>}
              {c.undone && <span className="text-fg3"> · undone</span>}
            </span>
            {!c.undone && (
              <button
                type="button"
                className="min-h-9 rounded-sm border border-line px-3 text-fg2 hover:text-fg disabled:opacity-50"
                disabled={busy === c.id}
                onClick={() => void undo(c)}
              >
                Undo
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="mt-2 break-words text-sm text-caution" role="status">
          {error}
        </p>
      )}
    </section>
  );
}

/** The steps of one request (`?plan=<task>`): what you asked for, where it stands, and each of its steps live. */
export function PlanStrip({ plan, byId }: { plan: PlanCard; byId: Map<string, RoadmapStep> }) {
  const said: Record<PlanCard["state"], string> = {
    planning: "The planner writes the steps.",
    approve: "The steps wait for your approval in the Inbox.",
    approved: "Approved. Each step starts when the steps before it are merged.",
    rejected: "Rejected. The roadmap stays as it was.",
    closed: "Closed. The roadmap stays as it was.",
  };
  const steps = plan.steps.map((id) => byId.get(id) ?? id);
  const merged = steps.filter((s) => typeof s !== "string" && s.state === "done").length;
  return (
    <section
      className="mt-8 rounded-lg border border-accent/30 bg-raised/40 p-4 md:p-5"
      aria-label="Your request"
      data-plan-strip={plan.task}
      data-plan-state={plan.state}
    >
      <h2 className="flex min-w-0 items-center gap-2 text-sm text-fg3">
        <RoleIcon role={DISPATCHER} size={13} hidden />
        <span className="truncate">Your request</span>
      </h2>
      <p className="mt-1.5 break-words text-base font-medium text-fg">{plan.goal}</p>
      <p className="mt-1 text-sm text-fg2">
        {said[plan.state]}
        {plan.state === "approve" && plan.item && (
          <>
            {" "}
            <a data-inline href={inboxPath(plan.item.id)} className="text-caution underline decoration-caution/40 underline-offset-4 hover:decoration-caution">
              Open it
            </a>
          </>
        )}
        {plan.state === "approved" && steps.length > 0 && ` ${merged} of ${steps.length} merged.`}
      </p>
      {steps.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {steps.map((s) =>
            typeof s === "string" ? (
              <li key={s} className="flex min-w-0 items-center gap-2 rounded bg-raised px-3 py-2 text-sm text-fg3" data-plan-step={s} data-state="planned">
                <StationPic look="ahead" size={14} />
                <span className="truncate">{plan.state === "approved" ? "A new step, not on main yet" : "A new step in the plan"}</span>
              </li>
            ) : (
              <li key={s.id} className="flex min-w-0 items-center gap-2 rounded bg-raised px-3 py-2 text-sm" data-plan-step={s.id} data-state={s.state}>
                <StepPic s={s} />
                <span className="shrink-0 font-semibold tabular-nums text-fg2">{s.id}</span>
                <span className="min-w-0 truncate text-fg" title={s.title}>
                  {s.title}
                </span>
                <span className="ml-auto shrink-0 text-xs text-fg3">{stateWord(s, byId)}</span>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
