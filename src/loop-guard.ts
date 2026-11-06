import { writeAtomic } from "../pi/atomic.ts";
import { configDir } from "../pi/config.ts";
import { addItem, isOpen, readItems } from "./inbox.ts";
import { listProjectNames, readSettings, readSetup, type Setup, setupRoles } from "./project.ts";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Failed ticks in a row after which the owner is told, once. */
const FAILED_TICKS = 3;

/**
 * An install made before the setup gate has no setup.json, but its projects already name the models they use. The
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
  mkdirSync(configDir(env), { recursive: true });
  writeAtomic(join(configDir(env), "setup.json"), `${JSON.stringify(next, null, 2)}\n`);
}

/** Counts ticks that failed in a row: the third puts one card in the Inbox (not another while it is open). A good tick resets. */
export function tickGuard(env = process.env): (error?: unknown) => void {
  let failed = 0;
  return (error) => {
    if (error === undefined) {
      failed = 0;
      return;
    }
    if (++failed !== FAILED_TICKS) return;
    const why = error instanceof Error ? error.message : String(error);
    const question = `The rule loop failed ${FAILED_TICKS} ticks in a row and starts nothing: ${why}`;
    if (readItems(env).some((i) => isOpen(i) && i.kind === "stuck" && i.alert === "The rule loop is failing")) return;
    addItem({ kind: "stuck", task: "-", question, choices: ["Ok"], alert: "The rule loop is failing", since: new Date().toISOString() }, env);
  };
}
