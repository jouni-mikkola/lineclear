import { Collapsible } from "@base-ui/react/collapsible";
import { Input } from "@base-ui/react/input";
import { useState } from "react";
import { Button } from "./parts.tsx";
import type { Reason } from "./model-list.tsx";

// Settings: the model list of each role, and each project's commands and
// secret names. The spec is docs/design.md.

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

const inputClass = "min-h-9 w-full min-w-0 rounded-sm border border-line bg-base px-3 font-mono text-sm text-fg placeholder:text-fg3";

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
  /** Details start open */
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
