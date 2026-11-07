import { Collapsible } from "@base-ui/react/collapsible";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  PageTitle,
  type PartState,
  Part,
  type AskKey,
  type ProjectSettings,
  ProjectSettingsCard,
  AccountPrice,
  type AccountSetting,
  ROLES,
} from "../kit/index.ts";
import { Alerts } from "./alerts.tsx";
import { type Load, sampleState, send } from "./data.ts";
import { useSetup } from "./setup.tsx";
import { Models, SetupChoice } from "./settings-models.tsx";
import type { SettingsData } from "./settings-empty.ts";
import { useAccountActions } from "./settings-account.ts";

// Settings at `/settings`: only what you set, in three sections. Models (the order per role and the accounts' prices),
// Projects (each one's commands) and Secrets (names only). On a desktop the sections sit on the left
// and the open one on the right; on a phone they are a grouped list and a tap opens one. What is only read, a
// machine's load and usage, is on Usage and Home. A sample state (`?state=`) changes only the page.

const SECTIONS = ["Models", "Projects", "Secrets"] as const;
type Section = (typeof SECTIONS)[number];

type Said = { text: string; failed?: boolean };

const PROJECTS_SHOWN = 12;

export function Settings({ load, sample }: { load: Load<SettingsData>; sample: boolean }) {
  const client = useQueryClient();
  // what a sample page changed, so its motions can be seen without a server
  const [saved, setSaved] = useState<Record<string, Partial<ProjectSettings>>>({});
  const [said, setSaid] = useState<Record<string, Said>>({});
  const [open, setOpen] = useState<Section | null>(null);
  const tell = (key: string, s: Said) => setSaid((x) => ({ ...x, [key]: s }));
  const refresh = () => client.invalidateQueries({ queryKey: ["settings"] });
  const { retired, showPaused, savePrice, retire, togglePaused } = useAccountActions({
    sample,
    tell,
    refresh,
    home: () => client.invalidateQueries({ queryKey: ["home"] }),
  });

  const setup = useSetup(sampleState());
  // the choice above and the lists below read one answer: with no harness logged in only its card shows
  const foundHarness = setup.status === "ok" && setup.data.harnesses.length > 0;

  if (load.status === "error") return <Part main state="error" label="Settings" empty={{ text: "" }} error={load.error} onRetry={load.retry} />;
  const d = load.status === "ok" ? load.data : undefined;
  const of = (empty: boolean) => (!d ? "loading" : empty ? "empty" : "filled");
  const projects = (d?.projects ?? []).map((p) => ({ ...p, ...saved[p.name] }));

  const save = async (p: ProjectSettings, change: { check: string; health: string }) => {
    setSaved((s) => ({ ...s, [p.name]: { check: change.check, health: change.health || undefined } }));
    if (sample) return tell(p.name, { text: "Saved." });
    const error = await send(`/api/projects/${encodeURIComponent(p.name)}`, change);
    if (error) {
      setSaved((s) => ({ ...s, [p.name]: {} }));
      tell(p.name, { text: error, failed: true });
    } else tell(p.name, { text: "Saved. The next check uses it." });
    await refresh();
  };

  const ask = async (p: ProjectSettings, key: AskKey, on: boolean) => {
    const askBefore = { plans: false, releases: true, spending: true, ...p.askBefore, [key]: on };
    setSaved((s) => ({ ...s, [p.name]: { ...s[p.name], askBefore } }));
    if (sample) return;
    const error = await send(`/api/projects/${encodeURIComponent(p.name)}`, { askBefore: { [key]: on } });
    if (error) {
      setSaved((s) => ({ ...s, [p.name]: {} }));
      tell(p.name, { text: error, failed: true });
    } else tell(p.name, { text: `Saved. ${on ? "You are asked" : "You are not asked"} before ${key}.` });
    await refresh();
  };
  const card = (p: ProjectSettings) => (
    <ProjectSettingsCard key={p.name} p={p} said={said[p.name]} onSave={(c) => void save(p, c)} onAsk={(k, on) => void ask(p, k, on)} />
  );

  const body: Record<Section, React.ReactNode> = {
    Models: (
      <div className="space-y-6">
        <SetupChoice />
        {!d && foundHarness && <Part state="loading" label="Models" empty={{ text: "" }} />}
        {d && foundHarness && (
          <>
            <Models roles={[...ROLES]} data={d} sample={sample} />
            <AccountPrices
              accounts={(d.accounts ?? []).map((a) => ({ ...a, retired: retired[a.account] ?? a.retired }))}
              said={said}
              onSave={savePrice}
              onRetire={retire}
            />
          </>
        )}
      </div>
    ),
    Projects: (
      <div className="space-y-6">
        <ShowPaused checked={showPaused ?? d?.showPaused === true} said={said.paused} onChange={(on) => void togglePaused(on)} />
        <Part state={of(!projects.length)} label="Projects" empty={{ text: "No projects yet." }}>
          <ProjectCards projects={projects} card={card} />
        </Part>
      </div>
    ),
    Secrets: (
      <div className="space-y-6">
        <Alerts sample={sample ? "off" : undefined} />
        <SecretNames state={of(!projects.length)} projects={projects} />
      </div>
    ),
  };
  return (
    <>
      <PageTitle>Settings</PageTitle>
      <Sections open={open} setOpen={setOpen} body={body} />
    </>
  );
}

function ShowPaused({ checked, said, onChange }: { checked: boolean; said?: Said; onChange: (on: boolean) => void }) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-fg max-sm:min-h-11">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid="show-paused" />
        Show paused projects and test spaces
      </label>
      {said && (
        <p className="mt-2 text-sm text-caution" role="status">
          {said.text}
        </p>
      )}
    </div>
  );
}

/** Each account's monthly price, when the owner has accounts. */
function AccountPrices({
  accounts,
  said,
  onSave,
  onRetire,
}: {
  accounts: AccountSetting[];
  said: Record<string, Said>;
  onSave: (account: string, price: string, currency: string) => Promise<void>;
  onRetire: (account: string, retired: boolean) => Promise<void>;
}) {
  if (!accounts.length) return null;
  return (
    <div className="space-y-2" data-accounts>
      <h3 className="text-sm font-medium text-fg">Account prices</h3>
      {accounts.map((a) => (
        <AccountPrice
          key={a.account}
          a={a}
          said={said[`price:${a.account}`]?.failed ? said[`price:${a.account}`] : undefined}
          onSave={(p, c) => void onSave(a.account, p, c)}
          onRetire={(r) => void onRetire(a.account, r)}
        />
      ))}
    </div>
  );
}

/** Each project's secret names, read-only: a value never reaches this page. */
function SecretNames({ state, projects }: { state: PartState; projects: ProjectSettings[] }) {
  return (
    <Part state={state} label="Secrets" empty={{ text: "No projects yet." }}>
      <ul className="space-y-3" data-secret-names>
        {projects.map((p) => (
          <li key={p.name} className="min-w-0 rounded-lg bg-raised2 p-4" data-secrets-of={p.name}>
            <h3 className="break-words font-medium text-fg">{p.name}</h3>
            {p.secrets.length ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {p.secrets.map((x) => (
                  <li key={x} className="break-all rounded-sm bg-raised3 px-2 py-0.5 font-mono text-xs text-fg">
                    {x}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-fg2">No secrets.</p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-fg2">Only names show. A value never reaches this page.</p>
    </Part>
  );
}

/** The four sections: a list at the left on a desktop, a grouped list on a phone where a tap opens one. */
function Sections({ open, setOpen, body }: { open: Section | null; setOpen: (s: Section | null) => void; body: Record<Section, React.ReactNode> }) {
  const shown = open ?? "Models";
  return (
    <div className="mt-10 md:mt-12 md:grid md:grid-cols-[240px_minmax(0,1fr)] md:gap-8" data-settings>
      <nav aria-label="Settings sections" className={open ? "hidden md:block" : ""}>
        <ul className="overflow-hidden rounded-lg bg-raised md:bg-transparent">
          {SECTIONS.map((x) => (
            <li key={x} className="border-b border-line last:border-b-0 md:border-b-0">
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-3 px-4 text-left text-base md:rounded-lg ${shown === x ? "text-fg md:bg-raised" : "text-fg hover:text-fg md:text-fg2"}`}
                aria-current={shown === x ? "page" : undefined}
                style={{ minHeight: 52 }}
                data-section={x}
                onClick={() => setOpen(x)}
              >
                {x}
                <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true" className="shrink-0 text-fg3 md:hidden">
                  <path d="M1.5 1.5 6 6l-4.5 4.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section className={`min-w-0 ${open ? "" : "hidden md:block"} md:rounded-lg md:bg-raised md:p-5`} aria-label={shown} data-section-panel={shown}>
        <header className="mb-4 flex items-center gap-2">
          <button
            type="button"
            className="-ml-2 inline-flex size-11 items-center justify-center rounded-sm text-fg2 hover:text-fg md:hidden"
            aria-label="Back to the sections"
            onClick={() => setOpen(null)}
          >
            <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true">
              <path d="M6.5 1.5 2 6l4.5 4.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
            </svg>
          </button>
          <h2 className="text-lg font-semibold text-fg">{shown}</h2>
        </header>
        {body[shown]}
      </section>
    </div>
  );
}

/** The projects' cards: the first few, the rest behind a button. */
function ProjectCards({ projects, card }: { projects: ProjectSettings[]; card: (p: ProjectSettings) => React.ReactNode }) {
  return (
    <>
      <div className="space-y-3">{projects.slice(0, PROJECTS_SHOWN).map(card)}</div>
      {projects.length > PROJECTS_SHOWN && (
        <Collapsible.Root className="mt-3">
          <Collapsible.Trigger className="text-sm text-fg2 hover:text-fg">{projects.length - PROJECTS_SHOWN} more projects</Collapsible.Trigger>
          <Collapsible.Panel>
            <div className="mt-3 space-y-3">{projects.slice(PROJECTS_SHOWN).map(card)}</div>
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
    </>
  );
}
