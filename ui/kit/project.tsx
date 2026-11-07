import { Input } from "@base-ui/react/input";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { play } from "./motion.ts";
import { Button } from "./parts.tsx";

// Starting the first project from Home.

/** What Lineclear finds in a repo folder. */
export interface Detection {
  repo: string;
  name: string;
  space?: string;
  check?: string;
  roadmap: boolean;
  models: string[];
}

/** A git repo found in the home's usual folders. */
export interface Repo {
  repo: string;
  name: string;
}

export interface NewProject {
  repo: string;
  name: string;
  space: string;
  check: string;
  models: string[];
}

/** What Start did: the reason it failed, or whether a first roadmap is being written. */
export type Started = { error: string } | { planning: boolean };

/** The repos offered under the field: the rest are typed. */
const SUGGESTED = 3;

const started = (name: string, planning: boolean) =>
  planning ? `Started ${name}. Lineclear is writing its first roadmap; the first step starts by itself.` : `Started ${name}. Its first step starts by itself.`;

const inputClass =
  "min-h-9 w-full min-w-0 rounded-sm border border-line bg-base px-3 font-mono text-sm text-fg placeholder:text-fg3 focus-visible:outline-2 focus-visible:outline-accent";

const Field = ({ id, label, children }: { id: string; label: string; children: ReactNode }) => (
  <div className="min-w-0">
    <label className="text-sm text-fg2" htmlFor={id}>
      {label}
    </label>
    <div className="mt-1">{children}</div>
  </div>
);

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0 sm:flex sm:gap-3">
    <dt className="w-24 shrink-0 text-sm text-fg3">{label}</dt>
    <dd className="min-w-0 break-words text-sm text-fg">{children}</dd>
  </div>
);

/**
 * The first day: pick a repo (those found in the home first), see what Lineclear found in it (its tests, the models pi
 * is logged in to, its roadmap or the first one it will write), and Start. A fact it could not find opens its field.
 */
export function AddProject({
  repos,
  onDetect,
  onSave,
}: {
  /** Undefined while the repos are looked up: the suggestions appear when they arrive. */
  repos: Repo[] | undefined;
  onDetect: (repo: string) => Promise<Detection | { error: string }>;
  onSave: (p: NewProject) => Promise<Started>;
}) {
  const [repo, setRepo] = useState("");
  const [found, setFound] = useState<Detection | undefined>();
  const [name, setName] = useState("");
  const [check, setCheck] = useState("");
  const [models, setModels] = useState("");
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<{ text: string; failed?: boolean } | undefined>();
  const [busy, setBusy] = useState(false);
  const details = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (found && details.current) play("part-change", details.current, [{ opacity: 0 }, { opacity: 1 }]);
  }, [found]);

  const look = async (folder: string) => {
    if (!folder.trim() || busy) return;
    setRepo(folder);
    setBusy(true);
    setSaid(undefined);
    const r = await onDetect(folder.trim());
    setBusy(false);
    if ("error" in r) {
      setFound(undefined);
      return setSaid({ text: r.error, failed: true });
    }
    setFound(r);
    setName(r.name);
    setCheck(r.check ?? "");
    setModels(r.models.join(", "));
    setOpen(false);
  };

  const save = async () => {
    if (!found || busy) return;
    setBusy(true);
    const r = await onSave({
      repo: found.repo,
      name: name.trim(),
      space: found.space ?? "",
      check: check.trim(),
      models: models.split(/[,\s]+/).filter(Boolean),
    });
    setBusy(false);
    if ("error" in r) return setSaid({ text: r.error, failed: true });
    setSaid({ text: started(name.trim(), r.planning) });
  };

  const noModels = found !== undefined && !found.models.length;
  return (
    <form
      className="rounded-lg border border-line p-4"
      data-add-project
      onSubmit={(e) => {
        e.preventDefault();
        void (found ? save() : look(repo));
      }}
    >
      <h2 className="text-base font-medium text-fg">Which repo should Lineclear work on?</h2>
      <label className="mt-3 block text-sm text-fg2" htmlFor="add-project-repo">
        The folder of a repo
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <Input
          id="add-project-repo"
          value={repo}
          onValueChange={(v) => {
            setRepo(v);
            setFound(undefined);
          }}
          placeholder="~/code/my-repo"
          className={`${inputClass} flex-1 basis-60`}
          autoComplete="off"
          spellCheck={false}
        />
        {!found && (
          <Button submit data-testid="look-project">
            Look
          </Button>
        )}
      </div>
      {!found && !!repos?.length && (
        <ul className="mt-3 flex flex-wrap gap-2" data-repos>
          {repos.slice(0, SUGGESTED).map((r) => (
            <li key={r.repo} className="min-w-0">
              <Button quiet onClick={() => void look(r.repo)} data-testid={`repo-${r.name}`}>
                {r.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {found && (
        <div ref={details} className="mt-4" data-detected>
          <dl className="space-y-2">
            <Fact label="Tests">{found.check ? <code className="font-mono">{check}</code> : "None found"}</Fact>
            <Fact label="Models">{noModels ? "None: pi is logged in to no model yet" : models}</Fact>
            <Fact label="Roadmap">
              <span data-roadmap-found={found.roadmap}>
                {found.roadmap ? "docs/ROADMAP.md" : "None yet. Lineclear writes a first one of at most 8 steps; you can undo it."}
              </span>
            </Fact>
          </dl>
          {(open || !found.check || noModels) && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field id="add-project-name" label="Name">
                <Input id="add-project-name" value={name} onValueChange={setName} className={inputClass} spellCheck={false} />
              </Field>
              <Field id="add-project-check" label="Check command">
                <Input id="add-project-check" value={check} onValueChange={setCheck} placeholder="npm test" className={inputClass} spellCheck={false} />
              </Field>
              <Field id="add-project-models" label="Models, best first">
                <Input
                  id="add-project-models"
                  value={models}
                  onValueChange={setModels}
                  placeholder="provider/model, provider/model"
                  className={inputClass}
                  spellCheck={false}
                />
              </Field>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button submit data-testid="save-project">
              Start
            </Button>
            {!open && found.check && !noModels && (
              <Button quiet onClick={() => setOpen(true)}>
                Change
              </Button>
            )}
          </div>
        </div>
      )}
      {said && (
        <p className={`mt-3 break-words text-sm ${said.failed ? "text-caution" : "text-fg2"}`} role="status">
          {said.text}
        </p>
      )}
    </form>
  );
}
