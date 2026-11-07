import { company } from "./company.ts";
import { type ModelEntry, readRegistry } from "./models.ts";
import { type Ask, readSetup, saveSetup, type Setup, type SetupRole, setupRoles } from "./project.ts";

const roleLabel: Record<SetupRole, string> = { worker: "worker", reviewer: "reviewer", stepChecker: "step checker" };
const flagOf = (r: SetupRole) => (r === "stepChecker" ? "step-checker" : r);

/** Each harness with the accounts (providers) logged in on it and how many models they offer. */
function listLoggedIn(registry: ModelEntry[], out: (l: string) => void): void {
  const seen = new Map<string, Map<string, number>>();
  for (const m of registry) {
    const accounts = seen.get(m.harness) ?? new Map<string, number>();
    accounts.set(m.provider, (accounts.get(m.provider) ?? 0) + 1);
    seen.set(m.harness, accounts);
  }
  for (const [harness, accounts] of seen) out(`${harness}: ${[...accounts].map(([a, n]) => `${a} (${n} models)`).join(", ")}`);
}

/** What the setup view draws: each harness with its accounts and their models as `provider/name`, and the roles chosen so far. */
export interface SetupView {
  harnesses: { name: string; accounts: { account: string; models: string[] }[] }[];
  chosen: Setup;
}

export function setupView(registry: ModelEntry[], env = process.env): SetupView {
  const byHarness = new Map<string, Map<string, string[]>>();
  for (const m of registry) {
    const accounts = byHarness.get(m.harness) ?? new Map<string, string[]>();
    accounts.set(m.provider, [...(accounts.get(m.provider) ?? []), `${m.provider}/${m.name}`]);
    byHarness.set(m.harness, accounts);
  }
  const harnesses = [...byHarness].map(([name, accounts]) => ({ name, accounts: [...accounts].map(([account, models]) => ({ account, models })) }));
  return { harnesses, chosen: readSetup(env) };
}

/** Saves a choice of models if every one is offered by a logged-in harness; shared by `lineclear setup` and the web. Returns the problem, or undefined. */
export function saveOffered(choice: Setup, registry: ModelEntry[], env = process.env): string | undefined {
  const offered = new Set(registry.map((m) => `${m.provider}/${m.name}`));
  for (const role of setupRoles) {
    const model = choice[role];
    if (model !== undefined && !offered.has(model)) return `no logged-in harness offers '${model}'`;
  }
  return saveSetup(choice, company, env);
}

/** `lineclear setup [--worker M --reviewer M --step-checker M]`: asks for each role not given, as `provider/name`. */
export async function setupMain(
  args: string[],
  out: (l: string) => void,
  ask: Ask,
  env = process.env,
  registry: ModelEntry[] = readRegistry(),
): Promise<number> {
  const given: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]?.replace(/^--/, "") ?? "";
    const value = args[i + 1];
    if (!args[i]?.startsWith("--") || !setupRoles.some((r) => flagOf(r) === flag) || value === undefined)
      return (out(`lineclear setup: unknown option '${args[i]}'`), 2);
    given[flag] = value;
  }
  if (registry.length === 0) return (out("lineclear setup: no harness is logged in, log in to one (for example pi) and run it again"), 1);
  listLoggedIn(registry, out);
  const have = readSetup(env);
  const choice: Setup = {};
  for (const role of setupRoles) {
    let model = given[flagOf(role)];
    if (model === undefined && ask)
      model = (await ask(`Model for the ${roleLabel[role]}${have[role] ? ` (now ${have[role]})` : ""}, as provider/name: `)).trim() || have[role];
    if (!model) return (out(`lineclear setup: no model for the ${roleLabel[role]}, pass --${flagOf(role)} <provider/name>`), 1);
    choice[role] = model;
  }
  const problem = saveOffered(choice, registry, env);
  if (problem) return (out(`lineclear setup: ${problem}`), 1);
  out(`saved: ${setupRoles.map((r) => `${roleLabel[r]} ${choice[r]}`).join(", ")}`);
  return 0;
}
