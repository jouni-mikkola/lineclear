import { listProjectNames, readSettings, readSetup, type Setup, setupRoles, writeSetup } from "./project.ts";

/**
 * An install made before the setup gate has no saved setup, but its projects already name the models they use. The
 * gap is filled from them (the first project that names a role wins), so an update never stops such a machine.
 * The step checker has no setting of its own; it takes the reviewer's model, else the worker's.
 */
export function fillSetup(env = process.env): void {
  const have = readSetup(env);
  if (setupRoles.every((r) => have[r])) return;
  const named: Setup = {};
  for (const name of listProjectNames(env)) {
    const s = readSettings(name, env);
    if (typeof s === "string") continue;
    for (const role of ["worker", "reviewer", "planner"] as const) named[role] ??= s.models?.[role]?.[0];
  }
  named.stepChecker ??= named.reviewer ?? named.worker;
  const found = Object.entries(named).filter(([, v]) => v);
  const next: Setup = { ...Object.fromEntries(found), ...Object.fromEntries(Object.entries(have).filter(([, v]) => v)) };
  if (Object.keys(next).length === setupRoles.filter((r) => have[r]).length) return;
  writeSetup(next, env);
}
