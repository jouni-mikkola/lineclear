import type { TaskDetail } from "../../src/task-detail.ts";
import { type Browser, type Column, DataTable, dollars, exact, type InboxItem, LivePicture, ago, type Project, type Task } from "../kit/index.ts";
import { type HomeData, type Load, useTaskDetail } from "./data.ts";
import { AskInRow } from "./inbox-strip.tsx";

type Choose = (item: InboxItem, choice: string, note?: string) => void;
import { samplePictureOf } from "./browser-samples.ts";

// Home's table of working tasks: one row each, the row opens in place with the log tail, the diff stat, the check,
// the review's findings and the task's browser.

interface Row {
  id: string;
  project: string;
  step: string;
  title: string;
  machine: string;
  stage: string;
  stuck: boolean;
  last?: Task["last"];
  files?: number;
  check?: "pass" | "fail";
  task: Task;
  /** The ask this task waits on, shown in its open row. */
  ask?: InboxItem;
}

const STAGE_WORD = { queued: "in line", work: "at work", review: "in review", ready: "ready to merge", done: "merged" } as const;

/** Every task at work or waiting on you, in the order of the projects. */
export function rowsOf(projects: Project[], loose: HomeData["loose"], host: string, asks: InboxItem[] = []): Row[] {
  const make = (project: string, t: Task): Row => ({
    id: t.id,
    project,
    step: t.step ?? "",
    title: t.title,
    machine: t.machine ?? host,
    stage: t.state === "need" ? (t.text ?? "waits for you") : t.silentSince ? "not reached" : t.stalled ? "no sign of life" : STAGE_WORD[t.stage ?? "work"],
    stuck: t.state === "need" || !!t.stalled,
    last: t.last,
    files: t.files,
    check: t.check,
    task: t,
    ask: asks.find((a) => a.task === t.id),
  });
  const working = (t: Task) => t.state === "need" || (t.state === "work" && t.stage !== "queued" && t.stage !== "done");
  return [...projects.flatMap((p) => p.tasks.filter(working).map((t) => make(p.name, t))), ...(loose ?? []).filter(working).map((t) => make(t.space, t))];
}

const columns: Column<Row>[] = [
  { key: "project", label: "Project" },
  {
    key: "step",
    label: "Step",
    show: (r) => (
      <span className="block min-w-14" title={r.title}>
        {r.step || r.title}
      </span>
    ),
  },
  { key: "machine", label: "Machine", show: (r) => <span className="whitespace-nowrap">{r.machine}</span> },
  { key: "stage", label: "Stage", show: (r) => <span className={`inline sm:block sm:min-w-28 ${r.stuck ? "text-caution" : "text-fg2"}`}>{r.stage}</span> },
  {
    key: "last",
    label: "Last",
    show: (r) =>
      r.last ? (
        <span className="block max-w-32 truncate" title={`${r.last.text} · ${exact(r.last.at)}`}>
          {r.last.text} · {ago(r.last.at)}
        </span>
      ) : (
        <span className="text-fg3">-</span>
      ),
    sortBy: (r) => r.last?.at ?? 0,
  },
  { key: "files", label: "Files", num: true, show: (r) => (r.files === undefined ? "-" : r.files) },
  {
    key: "check",
    label: "Check",
    show: (r) =>
      r.check ? (
        <span className={r.check === "fail" ? "text-caution" : "text-clear"}>{r.check === "pass" ? "passed" : "failed"}</span>
      ) : (
        <span className="text-fg3">-</span>
      ),
  },
];

function Details({ row, sample, browsers, onChoose }: { row: Row; sample: boolean; browsers: Load<Browser[]>; onChoose: Choose }) {
  const load = useTaskDetail(row.id, sample ? "filled" : undefined);
  const d: TaskDetail | undefined = load.status === "ok" ? load.data : undefined;
  const browser = browsers.status === "ok" ? browsers.data.find((b) => b.task === row.id || b.task === row.title) : undefined;
  const section = (name: string, body: React.ReactNode) => (
    <section className="min-w-0" aria-label={name}>
      <h3 className="mb-1 text-xs font-medium text-fg3">{name}</h3>
      {body}
    </section>
  );
  if (load.status === "error") return <p className="text-sm text-fg2">{load.error}</p>;
  if (!d)
    return (
      <p className="text-sm text-fg3" aria-busy="true">
        Reading the task.
      </p>
    );
  return (
    <div className="grid gap-4 text-sm lg:grid-cols-2" data-task-details={row.id}>
      {row.ask && <AskInRow item={row.ask} onChoose={onChoose} />}
      {section(
        "Log",
        d.log.length ? (
          <ol className="space-y-1 text-fg2">
            {d.log.map((l) => (
              <li key={l} className="break-words">
                {l}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-fg3">No card yet.</p>
        ),
      )}
      {section("Diff", d.diff ? <pre className="overflow-auto whitespace-pre text-xs text-fg2">{d.diff}</pre> : <p className="text-fg3">No change yet.</p>)}
      {section(
        "Check",
        d.check ? (
          <p className="break-words text-fg2">
            <span className={d.check.ok ? "text-clear" : "text-caution"}>{d.check.ok ? "passed" : "failed"}</span> · {d.check.command} · {d.check.seconds} s ·{" "}
            {ago(d.check.at)} ago
            {d.check.failed.length > 0 && <span className="block text-xs">{d.check.failed.join(", ")}</span>}
          </p>
        ) : (
          <p className="text-fg3">Not run yet.</p>
        ),
      )}
      {section(
        "Review",
        d.review.length ? (
          <ul className="space-y-1 text-fg2">
            {d.review.map((l) => (
              <li key={l} className="break-words">
                {l}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-fg3">No findings.</p>
        ),
      )}
      {section(
        "Cost so far",
        <p className="text-fg2" data-cost>
          {d.cost === undefined ? "not reported" : dollars(d.cost)}
        </p>,
      )}
      {browser &&
        section(
          "Browser",
          <LivePicture
            src={sample ? samplePictureOf(browser) : `/api/browsers/${encodeURIComponent(browser.session)}/picture`}
            every={2000}
            alt={`What ${row.step || row.title} shows now`}
            host={browser.page?.url}
          />,
        )}
    </div>
  );
}

export function TaskTable({ rows, sample, browsers, onChoose }: { rows: Row[]; sample: boolean; browsers: Load<Browser[]>; onChoose: Choose }) {
  return (
    <DataTable
      label="Working tasks"
      columns={columns}
      rows={rows}
      card={["stage", "check"]}
      height="fill"
      group={(r) => r.project}
      cardTitle={(r) => `${r.id}: ${r.step && !r.title.startsWith(r.step) ? `${r.step} ` : ""}${r.title}`}
      details={(r) => <Details row={r} sample={sample} browsers={browsers} onChoose={onChoose} />}
    />
  );
}
