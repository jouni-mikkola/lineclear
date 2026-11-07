import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, PageTitle, Part, type PartState } from "../kit/index.ts";
import type { SetupView } from "../../src/setup.ts";
import type { PageState } from "./samples.ts";
import { hasLists, sampleState, send, useLoad } from "./data.ts";
import { setupSample } from "./settings-samples.ts";

// The first run in the web: the harnesses and accounts found, and one model per role with none chosen for you. Settings
// shows the same panel and edits the choice afterwards. It saves where `lineclear setup` does.

const ROLES = [
  { id: "worker", label: "Worker" },
  { id: "reviewer", label: "Reviewer" },
  { id: "planner", label: "Planner" },
  { id: "stepChecker", label: "Step checker" },
] as const;
type RoleId = (typeof ROLES)[number]["id"];

const NONE: SetupView = { harnesses: [], chosen: {} };

/** The harnesses and accounts found and the models chosen per role. Read once a minute: finding them runs the harnesses. */
const useSetup = (state: PageState | undefined) => useLoad("setup", "/api/setup", state, setupSample, NONE, true, hasLists("harnesses"), 60_000);

type Said = { text: string; failed?: boolean };

/** The harnesses with the accounts logged in on each, and how many models each offers. */
function Found({ harnesses }: { harnesses: SetupView["harnesses"] }) {
  return (
    <ul className="space-y-1.5" data-found>
      {harnesses.map((h) => (
        <li key={h.name} className="min-w-0 rounded-sm bg-raised2 px-3 py-2 text-sm" data-harness={h.name}>
          <span className="font-medium text-fg">{h.name}</span>
          <span className="text-fg2">
            {" "}
            {h.accounts.map((a) => `${a.account} (${a.models.length} ${a.models.length === 1 ? "model" : "models"})`).join(", ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RolePick({ role, label, view, value, onPick }: { role: RoleId; label: string; view: SetupView; value: string; onPick: (m: string) => void }) {
  return (
    <div className="min-w-0">
      <label className="block text-sm font-medium text-fg" htmlFor={`setup-${role}`}>
        {label}
      </label>
      <select
        id={`setup-${role}`}
        className="mt-1 min-h-11 w-full min-w-0 max-w-full truncate rounded-sm border border-line bg-base px-2 text-sm text-fg md:min-h-9"
        value={value}
        onChange={(e) => onPick(e.target.value)}
        data-role-pick={role}
      >
        <option value="" disabled>
          Choose a model
        </option>
        {view.harnesses.flatMap((h) =>
          h.accounts.map((a) => (
            <optgroup key={`${h.name}/${a.account}`} label={`${h.name} · ${a.account}`}>
              {a.models.map((m) => (
                <option key={`${h.name}/${m}`} value={m}>
                  {m.slice(a.account.length + 1)}
                </option>
              ))}
            </optgroup>
          )),
        )}
      </select>
      {value && (
        <p className="mt-1 break-all text-xs text-fg2" data-chosen={role}>
          {value}
        </p>
      )}
    </div>
  );
}

function Picks({ view, sample }: { view: SetupView; sample: boolean }) {
  const client = useQueryClient();
  const [picks, setPicks] = useState<Partial<Record<RoleId, string>>>({});
  const [said, setSaid] = useState<Said | undefined>();
  const value = (r: RoleId) => picks[r] ?? view.chosen[r] ?? "";
  const save = async () => {
    if (sample) return setSaid({ text: "Saved." });
    const error = await send("/api/setup", picks);
    if (error) return setSaid({ text: error, failed: true });
    setPicks({});
    setSaid({ text: "Saved." });
    await client.invalidateQueries({ queryKey: ["setup"] });
  };
  const left = ROLES.filter((r) => !value(r.id)).length;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {ROLES.map((r) => (
          <RolePick key={r.id} role={r.id} label={r.label} view={view} value={value(r.id)} onPick={(m) => setPicks((p) => ({ ...p, [r.id]: m }))} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button submit data-testid="save-setup">
          Save
        </Button>
        <p className={`min-w-0 break-words text-sm ${said?.failed ? "text-caution" : "text-fg2"}`} role="status" data-setup-status>
          {said?.text ?? (left ? `${left} of 4 roles still need a model.` : "")}
        </p>
      </div>
    </form>
  );
}

/** What is found and the choice per role; the panel of the first run and of Settings. */
export function SetupPanel() {
  const sample = sampleState();
  const load = useSetup(sample);
  if (load.status === "error") return <Part state="error" label="Models" empty={{ text: "" }} error={load.error} onRetry={load.retry} />;
  const view = load.status === "ok" ? load.data : undefined;
  const state: PartState = !view ? "loading" : view.harnesses.length ? "filled" : "empty";
  return (
    <Part state={state} label="Models" empty={{ text: "No harness is logged in.", hint: "Log in to pi on this machine, then open this page again." }}>
      {view && (
        <div className="space-y-4" data-setup>
          <Found harnesses={view.harnesses} />
          <Picks view={view} sample={!!sample} />
        </div>
      )}
    </Part>
  );
}

/** `/setup`: the first-run view. */
export function Setup() {
  return (
    <>
      <PageTitle>Choose your models</PageTitle>
      <div className="mt-10 max-w-2xl md:mt-12">
        <SetupPanel />
      </div>
    </>
  );
}
