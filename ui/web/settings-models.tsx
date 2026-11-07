import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ProjectSettings, Role } from "../kit/index.ts";
import { ModelList, reorderReasons } from "../kit/model-list.tsx";
import { send } from "./data.ts";
import type { SettingsData } from "./settings-empty.ts";
import { SetupPanel } from "./setup.tsx";

// The order of a project's models per role and the Dispatcher's chat address, both set in Settings.

type Said = { text: string; failed?: boolean };

/** The model chosen for each role, edited after the first run. */
export function SetupChoice() {
  return (
    <div className="space-y-2" data-setup-choice>
      <h3 className="text-sm font-medium text-fg">Model per role</h3>
      <SetupPanel />
    </div>
  );
}

/** The order of a project's models for the given roles: one list per role, the project chosen above them. */
export function Models({ roles, data, sample }: { roles: Role[]; data: SettingsData; sample: boolean }) {
  const client = useQueryClient();
  const [orders, setOrders] = useState<Record<string, Record<Role, string[]>>>({});
  const [chosen, setChosen] = useState<string | undefined>();
  const [said, setSaid] = useState<Said | undefined>();
  const projects = data.projects.map((p) => ({ ...p, models: orders[p.name] ?? p.models }));
  const project = projects.find((p) => p.name === chosen) ?? projects.find((p) => roles.some((r) => p.models[r].length)) ?? projects[0];
  const served = data.projects.find((p) => p.name === project?.name);
  if (!project || !served) return null;
  const move = async (role: Role, p: ProjectSettings, from: number, to: number) => {
    const list = [...p.models[role]];
    list.splice(to, 0, ...list.splice(from, 1));
    setOrders((o) => ({ ...o, [p.name]: { ...p.models, [role]: list } }));
    if (sample) return;
    const error = await send(`/api/projects/${encodeURIComponent(p.name)}`, { models: { [role]: list } });
    if (error) {
      setOrders((o) => ({ ...o, [p.name]: p.models }));
      setSaid({ text: error, failed: true });
    } else setSaid({ text: `Saved the ${role} order of ${p.name}.` });
    await client.invalidateQueries({ queryKey: ["settings"] });
  };
  return (
    <div className="space-y-3">
      {projects.length > 1 && (
        <select
          className="min-h-9 max-w-full truncate rounded-sm border border-line bg-base px-2 text-sm text-fg"
          value={project.name}
          onChange={(e) => setChosen(e.target.value)}
          aria-label="Project"
          data-models-project
        >
          {projects.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <p className={`text-sm ${said?.failed ? "text-caution" : "text-fg2"}`} role="status">
        {said?.text ?? "Number 1 is used first. When its account is full, the next one takes over."}
      </p>
      {roles.map((role) => (
        <ModelList
          key={role}
          role={role}
          models={project.models[role]}
          reasons={reorderReasons(served.models[role], served.reasons?.[role], project.models[role])}
          onMove={(from, to) => void move(role, project, from, to)}
        />
      ))}
    </div>
  );
}
