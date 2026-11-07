import type { TaskDetail } from "../../src/task-detail.ts";
import { type Browser, type Column, DataTable, dollars, exact, type InboxItem, LivePicture, ago, Lamp } from "../kit/index.ts";
import { type Load, useTaskDetail } from "./data.ts";
import type { Row } from "./home-rows.ts";
import { AskInRow } from "./inbox-strip.tsx";

type Choose = (item: InboxItem, choice: string, note?: string) => void;
import { samples } from "./sample-loader.ts";

// Home's table of working tasks: one row each, the row opens in place with the log tail, the diff stat, the check,
// the review's findings and the task's browser.

// A value that is not known leaves its cell empty; nothing stands in for it. Each cell ends in an ellipsis inside its
// own width, so the table never grows past its column.
const cut = (width: string, text: string, tone = "") => (
  <span className={`inline-block truncate align-bottom ${width} ${tone}`} title={text}>
    {text}
  </span>
);

// In a table cell the wait sits under the phase; in a phone card it follows on the same line, so the title keeps its two lines.
const stateOf = (r: Row, stacked = true) => (
  <span className="flex min-w-0 items-center gap-2" title={r.wait ? `${r.phase}: ${r.wait}` : r.phase}>
    <Lamp tone={r.stuck ? "caution" : "clear"} size={8} />
    <span className={`min-w-0 ${stacked ? "" : "flex gap-2"}`}>
      <span className="block whitespace-nowrap text-fg">{r.phase}</span>
      {r.wait && <span className={`block max-w-28 truncate text-xs ${stacked ? "" : "self-center"} ${r.stuck ? "text-caution" : "text-fg2"}`}>{r.wait}</span>}
    </span>
  </span>
);

const columns: Column<Row>[] = [
  { key: "phase", label: "State", show: (r) => stateOf(r) },
  {
    key: "step",
    label: "Step",
    show: (r) => (
      <span className="block max-w-40 truncate" title={`${r.project}: ${r.title}`}>
        <span className="text-fg3">{r.project}</span> {r.step || r.title}
      </span>
    ),
    sortBy: (r) => `${r.project} ${r.step}`,
  },
  { key: "model", label: "Model", show: (r) => (r.task.model ? cut("max-w-28", r.task.model, "text-fg2") : null), sortBy: (r) => r.task.model ?? "" },
  {
    key: "time",
    label: "Time",
    num: true,
    show: (r) => (r.task.since === undefined ? null : <span className="whitespace-nowrap">{ago(r.task.since)}</span>),
    sortBy: (r) => r.task.since ?? 0,
  },
  {
    key: "last",
    label: "Last",
    show: (r) =>
      r.last ? (
        <span className="block max-w-28 truncate" title={`${r.last.text} · ${exact(r.last.at)}`}>
          {r.last.text} · {ago(r.last.at)}
        </span>
      ) : null,
    sortBy: (r) => r.last?.at ?? 0,
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
        "Runs on",
        <p className="break-words text-fg2" data-runs-on>
          {row.machine}
          {row.input !== undefined && ` · ${Math.round(row.input / 1000)}k tokens in`}
        </p>,
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
            src={sample ? samples().browser.samplePictureOf(browser) : `/api/browsers/${encodeURIComponent(browser.session)}/picture`}
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
      card={["time", "model"]}
      height="fill"
      group={(r) => r.project}
      cardTitle={(r) => (
        <>
          <span className="mb-1 block text-xs">{stateOf(r, false)}</span>
          {r.id}: {r.step && !r.title.startsWith(r.step) ? `${r.step} ` : ""}
          {r.title}
        </>
      )}
      details={(r) => <Details row={r} sample={sample} browsers={browsers} onChoose={onChoose} />}
    />
  );
}
