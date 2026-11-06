import { createContext, type ReactNode, useContext } from "react";
import type { RoadmapData, RoadmapStep } from "../../../src/roadmap-view.ts";
import type { StepRecord } from "../../../src/step-page.ts";
import { BackLink, ColdRead, dollars, Part, RoleIcon, type RoleName, Shape, when } from "../../kit/index.ts";
import type { Load } from "../data.ts";
import { roadmapPath } from "../routes.ts";
import { StepChain } from "./chain.tsx";
import { dedent, Label, openWaits, plural, StepPic, stateWord, titleList } from "./common.tsx";

/** The project whose steps are shown, for the link from a card to the step's page. */
export const ProjectContext = createContext("");

// A step: its details, and its page at `/<project>/roadmap/<step>` with its why and done when.

const Field = ({ label, by, children }: { label: string; by?: RoleName; children: ReactNode }) => (
  <div className="min-w-0">
    <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg3">
      {by && <RoleIcon role={by} size={13} hidden />}
      {label}
    </h3>
    <div className="mt-1 break-words text-sm text-fg2">{children}</div>
  </div>
);

const CHECK_WHEN: Record<string, string> = { inner: "while working", merge: "at merge", heavy: "after merge" };
const TASK_WORD: Record<string, string> = { work: "at work", need: "waits for you", queued: "in line", done: "merged" };

/** The step's task: its state, id and line, or why it has none. */
function StepTask({ s }: { s: RoadmapStep }) {
  if (!s.task) return s.dropped ? `Dropped: ${s.dropped}.` : "No task yet.";
  return (
    <span className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5">
        <Shape state={s.task.status === "need" ? "need" : s.task.status === "done" ? "done" : s.task.status === "work" ? "work" : "queued"} />
      </span>
      <span className="min-w-0">
        {TASK_WORD[s.task.status] ?? s.task.status}
        {s.task.sub ? `: ${s.task.sub}` : ""}
      </span>
    </span>
  );
}

export function StepDetails({ s, byId, rounds, panel }: { s: RoadmapStep; byId: Map<string, RoadmapStep>; rounds: number; panel?: boolean }) {
  const waits = openWaits(s, byId);
  const project = useContext(ProjectContext);
  return (
    <div className={panel ? "grid gap-5" : "mt-2 grid gap-5 rounded bg-raised p-4 md:grid-cols-2"} data-details={s.id}>
      <Field label="Why">{s.why || "The roadmap gives no reason."}</Field>
      <Field label="Done when" by="reviewer">
        <p className="whitespace-pre-wrap">{s.doneWhen ? dedent(s.doneWhen) : "The roadmap gives no test."}</p>
      </Field>
      <Field label="Task" by="worker">
        <StepTask s={s} />
      </Field>
      <Field label="Review rounds">Up to {plural(rounds, "round")} of review, then it asks you.</Field>
      <Field label="Waits for">
        {s.after.length ? (
          <>
            {titleList(s.after, byId)}
            {waits.length ? (
              <span className="block text-fg3">Still open: {waits.length === s.after.length ? "all of them" : titleList(waits, byId)}.</span>
            ) : (
              <span className="block text-fg3">All done.</span>
            )}
          </>
        ) : (
          "Nothing: it can start at once."
        )}
      </Field>
      <Field label="Commits">
        {s.commits.length ? (
          <ul className="space-y-1">
            {s.commits.map((c) => (
              <li key={c.commit} className="flex min-w-0 gap-2">
                <code className="shrink-0 text-fg3">{c.commit.slice(0, 7)}</code>
                <span className="min-w-0 truncate" title={c.subject}>
                  {c.subject}
                </span>
                <time className="ml-auto shrink-0 text-fg3">{when(c.at)}</time>
              </li>
            ))}
          </ul>
        ) : (
          "None on main yet."
        )}
      </Field>
      {project && !panel && (
        <a href={roadmapPath(project, s.id)} className="text-sm text-fg2 underline decoration-line3 underline-offset-4 hover:text-fg" data-step-link>
          Open {s.id} as a page
        </a>
      )}
    </div>
  );
}

const NOT_REPORTED = <span className="text-fg3">not reported</span>;

/** A span of milliseconds in the units a person reads: "25 min", "1 h 5 min". */
function span(ms: number) {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex min-w-0 gap-3 py-1.5 text-sm">
    <dt className="w-40 shrink-0 text-fg3">{label}</dt>
    <dd className="min-w-0 break-words text-fg2">{children}</dd>
  </div>
);

const link = "underline decoration-line3 underline-offset-4 hover:text-fg";

const ReadRow = ({ read }: { read: StepRecord["read"] }) => <Row label="Read cold">{read.length ? <ColdRead readings={read} /> : NOT_REPORTED}</Row>;

/** The history of a step: its task, branch and pull request, review, checks, times and cost. */
function StepHistory({ h, read }: { h: NonNullable<StepRecord["history"]>; read: StepRecord["read"] }) {
  return (
    <dl className="divide-y divide-line">
      <ReadRow read={read} />
      <Row label="Branch">{h.branch ?? NOT_REPORTED}</Row>
      <Row label="Pull request">
        {h.pr ? (
          <a href={h.pr.url} className={link}>
            #{h.pr.number}
          </a>
        ) : (
          NOT_REPORTED
        )}
      </Row>
      <Row label="Review">
        {h.review ? (
          <ul className="space-y-1">
            {h.review.map((r) => (
              <li key={r.round ?? r.findings}>{r.round ? `Round ${r.round}: ${r.findings}` : r.findings}</li>
            ))}
          </ul>
        ) : (
          NOT_REPORTED
        )}
      </Row>
      <Row label="Check runs">
        {h.checks.length ? (
          <ul className="space-y-1">
            {h.checks.map((c) => (
              <li key={c.at} data-check={c.ok ? "passed" : "failed"}>
                {c.ok ? "passed" : "failed"} · {CHECK_WHEN[c.tier] ?? c.tier} · {c.seconds} s · <time className="text-fg3">{when(c.at)}</time>
                {c.failed.length ? <span className="block text-fg3">{c.failed.join(", ")}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          NOT_REPORTED
        )}
      </Row>
      <Row label="Waited in line">{h.readyToStart !== undefined ? span(h.readyToStart) : NOT_REPORTED}</Row>
      <Row label="Start to merge">{h.startToMerge !== undefined ? span(h.startToMerge) : NOT_REPORTED}</Row>
      <Row label="Cost">{h.cost !== undefined ? dollars(h.cost) : NOT_REPORTED}</Row>
    </dl>
  );
}

/** What the record adds to a step's page: its checklist, what holds it up and its history, in that order after what it gives. */
function StepRecordParts({ d, s, byId, record }: { d: RoadmapData; s: RoadmapStep; byId: Map<string, RoadmapStep>; record: Load<StepRecord> }) {
  const gives = (
    <section data-step-part="gives">
      <p className="text-base text-fg">
        {s.result || "The roadmap gives no result."} {s.why}
      </p>
    </section>
  );
  const chain = <StepChain d={d} id={s.id} />;
  if (record.status === "loading")
    return (
      <>
        {gives}
        {chain}
        <Part main state="loading" label="Its checklist" empty={{ text: "" }} rows={3} />
      </>
    );
  if (record.status === "error")
    return (
      <>
        {gives}
        {chain}
        <Part main state="error" label="Its checklist" empty={{ text: "" }} error={record.error} onRetry={record.retry} />
      </>
    );
  const r = record.data;
  return (
    <>
      {gives}
      <section data-step-part="checklist">
        <Label>Done when</Label>
        {r.checklist.length ? (
          <ul className="space-y-2">
            {r.checklist.map((c) => (
              <li key={c.text} className="flex min-w-0 items-start gap-2 text-sm text-fg2" data-item={c.evidence ? "met" : "open"}>
                <span className={`mt-0.5 shrink-0 ${c.evidence ? "text-clear" : "text-fg3"}`} aria-hidden="true">
                  {c.evidence ? "✓" : "○"}
                </span>
                <span className="min-w-0 break-words">
                  {c.text}
                  <span className="block text-fg3">{c.evidence ?? "no evidence yet"}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg3">The roadmap gives no test.</p>
        )}
      </section>
      <section data-step-part="state">
        <Label>State</Label>
        <p className="text-sm text-fg2">
          {stateWord(s, byId)}
          {s.phase ? `, in ${s.phase}` : ""}
        </p>
        {r.waits.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-fg2">
            {r.waits.map((w) => (
              <li key={`${w.kind}${w.text}`} data-wait={w.kind}>
                <a href={w.href} className={link}>
                  {w.text}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      {chain}
      <section data-step-part="history">
        <Label>History</Label>
        {r.history ? (
          <StepHistory h={r.history} read={r.read} />
        ) : (
          <>
            {r.read.length > 0 && (
              <dl>
                <ReadRow read={r.read} />
              </dl>
            )}
            <p className="text-sm text-fg3">No task yet: nothing to report.</p>
          </>
        )}
      </section>
    </>
  );
}

/** A step at its own address: what it gives and why, its done when as a checklist, its state and what it waits for, its chain as rail, then its history. */
export function StepPage({ d, id, record }: { d: RoadmapData; id: string; record: Load<StepRecord> }) {
  const byId = new Map(d.steps.map((s) => [s.id, s]));
  const s = byId.get(id);
  if (!s) {
    return (
      <>
        <BackLink href={roadmapPath(d.project)}>{d.project} roadmap</BackLink>
        <div className="mt-6">
          <Part main state="empty" label="The step" empty={{ text: `${d.project} has no step ${id}.` }} />
        </div>
      </>
    );
  }
  return (
    <>
      <BackLink href={roadmapPath(d.project)}>{d.project} roadmap</BackLink>
      <header className="mt-6 flex min-w-0 items-center gap-3" data-step-page={s.id} data-state={s.state}>
        <StepPic s={s} size={18} />
        <h1 className="min-w-0 break-words text-2xl font-semibold text-fg">
          <span className="tabular-nums text-fg2">{s.id}</span> {s.title}
        </h1>
      </header>
      <div className="mt-6 grid gap-8">
        <StepRecordParts d={d} s={s} byId={byId} record={record} />
      </div>
    </>
  );
}
