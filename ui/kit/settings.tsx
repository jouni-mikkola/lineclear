import { Collapsible } from "@base-ui/react/collapsible";
import { Input } from "@base-ui/react/input";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { grow, play } from "./motion.ts";
import { Button, useFlip } from "./parts.tsx";
import { SidingsPic } from "./rail.tsx";
import type { Reason } from "./model-list.tsx";
import { Shape, Stop } from "./shapes.tsx";

// Settings: machines with their state and load, the model list of each role, and each project's commands and
// secret names. The spec is docs/design.md.

export type MachineState = "installing" | "ready" | "failed" | "unreachable";

export interface Machine {
  host: string;
  /** The machine Lineclear's server runs on. */
  local: boolean;
  state: MachineState;
  /** The doctor's lines, or why the install failed. */
  doctor?: string[];
  load?: number;
  limit?: number;
  /** The commit of the Lineclear it runs, whether it differs from this machine's, how it stands to it (git ancestry), and whether it is stable. */
  version?: string;
  behind?: boolean;
  relation?: "behind" | "ahead" | "different";
  stable?: boolean;
  /** Its task slots: how many tasks may work on it at once, and how many do now. */
  slots?: { total: number; busy: number };
}

export const ROLES = ["worker", "reviewer", "planner"] as const;
export type Role = (typeof ROLES)[number];

export interface ProjectSettings {
  name: string;
  repo: string;
  check: string;
  health?: string;
  models: Record<Role, string[]>;
  /** Why each model of each list is or is not in use now, in the list's order. */
  reasons?: Record<Role, Reason[]>;
  /** Secret names only: a value never reaches a page. */
  secrets: string[];
  /** What the owner is asked before. Missing means plans off, releases and spending on. */
  askBefore?: AskBefore;
}

const ASK_KEYS = ["plans", "releases", "spending"] as const;
export type AskKey = (typeof ASK_KEYS)[number];
type AskBefore = Record<AskKey, boolean>;

/** How a machine reads at a glance: busy is a ready machine over its load limit, where new tasks wait. */
export type MachineLook = "installing" | "ready" | "busy" | "broken";

const MACHINE_WORD: Record<MachineLook, string> = {
  installing: "installing over SSH",
  ready: "ready",
  busy: "busy, new tasks wait",
  broken: "needs a fix",
};

const isBusy = (m: Machine) => m.load !== undefined && m.limit !== undefined && m.load > m.limit;

export function machineLook(m: Machine): MachineLook {
  if (m.state === "failed" || m.state === "unreachable") return "broken";
  if (m.state === "installing") return "installing";
  return isBusy(m) ? "busy" : "ready";
}

/** Why a broken machine is broken, in one line: the doctor's first FAILED line, else why SSH or the install failed. */
const faultReason = (m: Machine) =>
  m.doctor?.find((l) => l.startsWith("FAILED"))?.replace(/^FAILED\s+/, "") ??
  (m.state === "unreachable" ? "SSH cannot reach it" : m.doctor?.find((l) => !/^ok\s/.test(l)));

/** What a machine's card says under its name: why it is broken, or its look. */
const machineWord = (m: Machine) => (m.state === "unreachable" ? "cannot be reached over SSH" : MACHINE_WORD[machineLook(m)]);

const inputClass = "min-h-9 w-full min-w-0 rounded-sm border border-line bg-base px-3 font-mono text-sm text-fg placeholder:text-fg3";

const POP: Keyframe[] = [
  { transform: "scale(0.4)", opacity: 0.4 },
  { transform: "scale(1.2)", opacity: 1, offset: 0.6 },
  { transform: "scale(1)", opacity: 1 },
];

/**
 * A machine's look as a shape: a lit train while it installs, a green station when ready, an outline train in line when busy,
 * the red square when broken.
 */
function MachineMark({ state }: { state: MachineLook }) {
  const host = useRef<HTMLSpanElement>(null);
  const was = useRef(state);
  useLayoutEffect(() => {
    if (was.current === state || !host.current) return;
    was.current = state;
    play("machine-state", host.current, POP);
  }, [state]);
  return (
    <span ref={host} className="inline-flex size-4 shrink-0 items-center justify-center" data-machine-mark={state}>
      {state === "installing" ? (
        <Shape state="work" size={16} />
      ) : state === "ready" ? (
        <Shape state="done" size={16} />
      ) : state === "busy" ? (
        <Shape state="queued" size={16} />
      ) : (
        <Stop size={16} />
      )}
    </span>
  );
}

/**
 * A machine's load average against its load limit (L7): the bar fills to the limit mark, and past it in grey,
 * because no new task starts there then. A new reading grows the bar to it; nothing moves at rest.
 */
function LoadGauge({ load, limit }: { load: number; limit: number }) {
  const scale = Math.max(limit * 1.25, load, 0.01);
  const under = Math.min(load, limit) / scale;
  const over = Math.max(0, load - limit) / scale;
  const busy = load > limit;
  // a new reading grows the bar from what it showed
  const fill = useRef<HTMLDivElement>(null);
  const was = useRef(under);
  useLayoutEffect(() => {
    if (fill.current) grow(fill.current, was.current, under, "x");
    was.current = under;
  }, [under]);
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-3 text-xs text-fg3">
        <span>
          Load <span className={`text-lg font-semibold tabular-nums text-fg`}>{load.toFixed(2)}</span> of {limit}
        </span>
        <span className={`tabular-nums ${busy ? "text-fg" : ""}`}>{Math.round((load / limit) * 100)}%</span>
      </figcaption>
      <div
        className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-line"
        role="meter"
        aria-label="load against the load limit"
        aria-valuemin={0}
        aria-valuemax={Math.max(limit, load)}
        aria-valuenow={load}
        aria-valuetext={`${load.toFixed(2)} of ${limit}`}
        data-load={load}
      >
        <div ref={fill} className="absolute inset-y-0 left-0 origin-left rounded-full bg-clear" style={{ width: `${under * 100}%` }} />
        <div className="absolute inset-0 origin-left bg-fg2" style={{ transform: `translateX(${under * 100}%) scaleX(${over})` }} />
        <div className="absolute inset-y-0 w-0.5 bg-fg2" style={{ left: `${(limit / scale) * 100}%` }} />
      </div>
    </figure>
  );
}

const LoadLine = ({ m }: { m: Machine }) =>
  m.load !== undefined && m.limit !== undefined ? (
    <LoadGauge load={m.load} limit={m.limit} />
  ) : (
    <p className="min-h-[38px] text-xs text-fg3">
      {m.state === "installing" ? "Its load shows once it is ready." : m.state === "ready" ? "Reading its load over SSH." : "No load to read."}
    </p>
  );

/** One machine: its look, its load against its limit, and its doctor behind Details. A broken or behind machine has a button that fixes it. */
export function MachineCard({ m, onRetry, onRemove }: { m: Machine; onRetry?: () => void; onRemove?: () => void }) {
  const look = machineLook(m);
  const bad = look === "broken";
  // an unreachable machine's own line already says why
  const fault = bad && m.state !== "unreachable" ? faultReason(m) : undefined;
  return (
    <article
      className={`rounded-lg border bg-raised2 p-4 ${bad ? "border-stop/40" : look === "busy" ? "border-line2" : "border-line"}`}
      data-machine={m.host}
      data-state={m.state}
      data-look={look}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <MachineMark state={look} />
        <h3 className="min-w-0 truncate font-medium text-fg" title={m.host}>
          {m.host}
        </h3>
        {m.local && <span className="shrink-0 rounded-full bg-raised3 px-2 text-xs text-fg2">this machine</span>}
      </div>
      <p className={`mt-1 text-sm ${bad ? "text-stop" : look === "busy" ? "text-fg" : "text-fg2"}`}>{machineWord(m)}</p>
      {fault && (
        <p className="mt-1 truncate text-xs text-fg2" title={fault} data-fault>
          {fault}
        </p>
      )}
      {m.version && (
        <p className={`mt-1 text-xs ${m.behind ? "text-caution" : "text-fg3"}`} data-version={m.version}>
          Lineclear {m.version.slice(0, 7)}
          {m.relation && `, ${{ behind: "older than", ahead: "newer than", different: "apart from" }[m.relation]} this machine`}
          {m.stable && ", stable"}
        </p>
      )}
      <div className="mt-3">
        <LoadLine m={m} />
      </div>
      {m.slots && (
        <figure className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-slots>
          <SidingsPic total={m.slots.total} busy={m.slots.busy} />
          <figcaption className="text-xs text-fg2">
            <span className="tabular-nums text-fg">{m.slots.busy}</span> of <span className="tabular-nums">{m.slots.total}</span> task slots busy
          </figcaption>
        </figure>
      )}
      <Collapsible.Root className="mt-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {m.doctor && m.doctor.length > 0 && <Collapsible.Trigger className="text-sm text-fg3 hover:text-fg">Details</Collapsible.Trigger>}
          {(bad || m.behind) && onRetry && (
            <Button quiet onClick={onRetry} data-fix={m.host}>
              {bad ? "Fix" : "Update"}
            </Button>
          )}
          {onRemove && m.state !== "installing" && (
            <button className="text-sm text-fg3 underline decoration-line underline-offset-4 hover:text-fg" onClick={onRemove} data-remove={m.host}>
              Remove
            </button>
          )}
        </div>
        {m.doctor && m.doctor.length > 0 && (
          <Collapsible.Panel>
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-base p-3 font-mono text-xs text-fg2" data-doctor>
              {m.doctor.filter((l) => !/^\s+fix:/.test(l)).join("\n")}
            </pre>
          </Collapsible.Panel>
        )}
      </Collapsible.Root>
    </article>
  );
}

const MACHINES_SHOWN = 12;

/** A machine as a setting: a 52 px row of its host and Remove. Its state and load are not here; Home shows them. */
export function MachineSetting({ m, onRemove }: { m: Machine; onRemove?: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg bg-raised2 px-4" style={{ minHeight: 52 }} data-machine-row={m.host}>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg" title={m.host}>
        {m.host}
      </span>
      {m.local && <span className="shrink-0 text-xs text-fg2">this machine</span>}
      {onRemove && (
        <button className="shrink-0 text-sm text-fg3 underline decoration-line underline-offset-4 hover:text-fg" onClick={onRemove} data-remove={m.host}>
          Remove
        </button>
      )}
    </div>
  );
}

/** The machines as a grid of cards, or one column of rows, this one first. A machine that is added drops in and the rest slide down. */
export function MachineList({ items, card, rows }: { items: Machine[]; card: (m: Machine) => ReactNode; rows?: boolean }) {
  const grid = rows ? "grid gap-2" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";
  const list = useRef<HTMLUListElement>(null);
  useFlip(list, "machine-add", "machine-add", undefined, true);
  const li = (m: Machine) => (
    <li key={m.host} data-key={m.host} className="min-w-0">
      {card(m)}
    </li>
  );
  return (
    <div>
      <ul ref={list} className={`relative ${grid}`} data-machines>
        {items.slice(0, MACHINES_SHOWN).map(li)}
      </ul>
      {items.length > MACHINES_SHOWN && (
        <Collapsible.Root className="mt-3">
          <Collapsible.Trigger className="text-sm text-fg3 hover:text-fg">{items.length - MACHINES_SHOWN} more machines</Collapsible.Trigger>
          <Collapsible.Panel>
            <ul className={`mt-3 ${grid}`}>{items.slice(MACHINES_SHOWN).map(li)}</ul>
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
    </div>
  );
}

/** Adds a machine by its SSH host: a small button that opens the form in place. */
export function AddMachine({ onAdd, said }: { onAdd: (host: string) => void; said?: { text: string; failed?: boolean } }) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState("");
  return (
    <div>
      {open ? (
        <form
          className="rounded-lg border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (host.trim()) onAdd(host.trim());
            setHost("");
            setOpen(false);
          }}
        >
          <label className="text-sm text-fg2" htmlFor="add-machine">
            SSH host
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              id="add-machine"
              value={host}
              onValueChange={setHost}
              placeholder="build-box or me@10.0.0.5"
              className={`${inputClass} flex-1 basis-60`}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <Button submit data-testid="add-machine">
              Add
            </Button>
            <Button quiet onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button quiet onClick={() => setOpen(true)} data-testid="open-add-machine">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          Add machine
        </Button>
      )}
      {said && (
        <p className={`mt-2 break-words text-sm ${said.failed ? "text-caution" : "text-fg2"}`} role="status">
          {said.text}
        </p>
      )}
    </div>
  );
}

/** What a command runs, without the set-up around it: `export PATH=...; npm run verify` is `npm run verify`. */
function commandSummary(cmd: string) {
  const parts = cmd
    .split(/\s*(?:;|&&)\s*/)
    .map((x) => x.trim())
    .filter((x) => x && !/^(export\s|cd\s|source\s|\.\s|set\s+-|\w+=\S*$)/.test(x));
  return parts.join(" && ") || cmd;
}

/**
 * A project's settings in plain words: what its check runs and how many secrets it has. The health command and the
 * rest are edited behind Details; a secret is added with the CLI, so a value never goes through a page.
 */
export function ProjectSettingsCard({
  p,
  onSave,
  onAsk,
  said,
  open,
}: {
  p: ProjectSettings;
  onSave?: (change: { check: string; health: string }) => void;
  /** Called at once when an `Ask me before` box is ticked or cleared. */
  onAsk?: (key: AskKey, on: boolean) => void;
  said?: { text: string; failed?: boolean };
  /** Details start open, as on /design */
  open?: boolean;
}) {
  const [check, setCheck] = useState<string | undefined>();
  const [health, setHealth] = useState<string | undefined>();
  const changed = (check !== undefined && check !== p.check) || (health !== undefined && health !== (p.health ?? ""));
  const n = p.secrets.length;
  const chip = "break-all rounded-sm bg-raised3 px-1.5 py-0.5 font-mono text-xs text-fg";
  return (
    <form
      className="grid gap-x-8 gap-y-3 rounded-lg border border-line bg-raised2 p-4 md:grid-cols-[220px_1fr]"
      data-project-settings={p.name}
      onSubmit={(e) => {
        e.preventDefault();
        if (!changed) return;
        onSave?.({ check: check ?? p.check, health: health ?? p.health ?? "" });
        setCheck(undefined);
        setHealth(undefined);
      }}
    >
      <div className="min-w-0">
        <h3 className="break-words font-medium text-fg">{p.name}</h3>
        <p className="mt-0.5 truncate text-sm text-fg2" title={p.repo}>
          {p.repo}
        </p>
      </div>
      <div className="min-w-0 space-y-3">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 text-sm">
          <dt className="text-fg2">Check</dt>
          <dd className="min-w-0" data-check-summary>
            <code className={chip} data-command-ok>
              {commandSummary(p.check)}
            </code>
          </dd>
          <dt className="text-fg2">Secrets</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" data-secrets={p.name}>
            <span className="text-fg" title={p.secrets.join(", ")}>
              {n ? `${n} ${n === 1 ? "secret" : "secrets"}` : "No secrets"}
            </span>
          </dd>
        </dl>
        <Collapsible.Root defaultOpen={open}>
          <Collapsible.Trigger className="text-sm text-fg2 hover:text-fg">Details</Collapsible.Trigger>
          <Collapsible.Panel className="mt-3 space-y-3">
            <label className="block">
              <span className="text-xs text-fg2">Check command, run before every merge</span>
              <Input
                value={check ?? p.check}
                onValueChange={setCheck}
                className={`${inputClass} mt-1`}
                spellCheck={false}
                aria-label={`${p.name} check command`}
              />
            </label>
            <label className="block">
              <span className="text-xs text-fg2">Health command for main, optional</span>
              <Input
                value={health ?? p.health ?? ""}
                onValueChange={setHealth}
                placeholder="none"
                className={`${inputClass} mt-1`}
                spellCheck={false}
                aria-label={`${p.name} health command`}
              />
            </label>
            <fieldset data-ask-before={p.name}>
              <legend className="text-xs text-fg2">Ask me before</legend>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                {ASK_KEYS.map((k) => (
                  <label key={k} className="flex min-h-9 items-center gap-2 text-sm text-fg">
                    <input
                      type="checkbox"
                      checked={(p.askBefore ?? { plans: false, releases: true, spending: true })[k]}
                      onChange={(e) => onAsk?.(k, e.target.checked)}
                      aria-label={`Ask me before ${k}`}
                    />
                    {k}
                  </label>
                ))}
              </div>
            </fieldset>
            {n > 0 && (
              <div>
                <span className="text-xs text-fg2">Secret names. A value never reaches this page.</span>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {p.secrets.map((x) => (
                    <li key={x} className="flex min-w-0 max-w-full items-center gap-1.5 rounded-sm bg-raised2 px-2 py-0.5 font-mono text-xs text-fg2">
                      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="shrink-0">
                        <rect x="1.5" y="4.5" width="7" height="5" rx="1" fill="currentColor" />
                        <path d="M3 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                      </svg>
                      <span className="break-all">{x}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Collapsible.Panel>
        </Collapsible.Root>
        {(changed || said) && (
          <div className="flex flex-wrap items-center gap-3">
            {changed && (
              <>
                <Button submit>Save</Button>
                <Button
                  quiet
                  onClick={() => {
                    setCheck(undefined);
                    setHealth(undefined);
                  }}
                >
                  Undo
                </Button>
              </>
            )}
            {said && !changed && (
              <p className={`break-words text-sm ${said.failed ? "text-caution" : "text-fg2"}`} role="status">
                {said.text}
              </p>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
