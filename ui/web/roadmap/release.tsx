import { checkWord, type ReleaseCheck, type ReleaseView } from "../../../src/release-view.ts";
import { Fill } from "./bar.tsx";
import { Label } from "./common.tsx";

// Where the next release stands, at the top of the Roadmap: a bar per part and a lamp per check, the same object
// `lineclear release` prints. Green holds, amber is not yet; nothing here is broken, so nothing is red.

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A check's lamp: green when it holds, amber when it fails, an amber ring when it is not measured yet. */
function Lamp({ c, className = "" }: { c: ReleaseCheck; className?: string }) {
  const look = c.state === "holds" ? "bg-clear" : c.state === "fails" ? "bg-caution" : "border border-caution";
  return (
    <span
      aria-hidden="true"
      className={`${className} inline-block size-2 shrink-0 rounded-full transition-colors duration-200 motion-reduce:transition-none ${look}`}
    />
  );
}

function PartBar({ name, done, total }: { name: string; done: number; total: number }) {
  return (
    <li className="min-w-0" data-release-part={name}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 break-words text-fg">{capital(name)}</span>
        <span className="shrink-0 tabular-nums text-fg2">
          {done} of {total}
        </span>
      </div>
      <div className="mt-1" role="img" aria-label={`${capital(name)}: ${done} of ${total} steps done`}>
        <Fill share={total ? (done / total) * 100 : 0} />
      </div>
    </li>
  );
}

export function ReleaseHead({ r }: { r: ReleaseView }) {
  const holds = r.checks.filter((c) => c.state === "holds").length;
  return (
    <section className="mb-6" aria-label={`Release ${r.version}`} data-release>
      <Label>Release {r.version}: where it stands</Label>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
        {r.parts.map((p) => (
          <PartBar key={p.rank} name={p.name} done={p.done} total={p.total} />
        ))}
        {r.unranked.total > 0 && <PartBar name="not ranked yet" done={r.unranked.done} total={r.unranked.total} />}
      </ul>
      <details className="mt-4 text-sm" data-release-checks>
        <summary className="flex min-h-10 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-fg2 hover:text-fg">
          <span>
            Checks: {holds} of {r.checks.length} hold
          </span>
          <span className="flex flex-wrap gap-1">
            {r.checks.map((c) => (
              <Lamp key={c.id} c={c} />
            ))}
          </span>
        </summary>
        <ul className="mt-2 space-y-2">
          {r.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-3" data-check={c.id} data-check-state={c.state}>
              <Lamp c={c} className="mt-1.5" />
              <span className="w-8 shrink-0 text-fg3">{c.id}</span>
              <span className="min-w-0 flex-1 break-words text-fg2 [overflow-wrap:anywhere]">
                {c.must} <span className={c.state === "holds" ? "text-clear" : c.state === "fails" ? "text-caution" : "text-fg3"}>({checkWord(c)})</span>
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
