import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ModelEntry {
  harness: string;
  provider: string;
  name: string;
}

export interface Harness {
  name: string;
  cmd: string[];
  parse: (out: string) => Omit<ModelEntry, "harness">[];
}

/** pi prints a header row, then `provider model ...` per line. */
const parseTable = (out: string) =>
  out
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const [provider, name] = line.trim().split(/\s+/);
      return provider && name ? [{ provider, name }] : [];
    });

export function harnesses(env: NodeJS.ProcessEnv = process.env): Harness[] {
  return [{ name: "pi", cmd: [env.PI_BIN ?? "pi", "--list-models"], parse: parseTable }];
}

function listOne(h: Harness): ModelEntry[] {
  try {
    const p = Bun.spawnSync(h.cmd, { stdin: "ignore", stderr: "ignore", timeout: 20_000 });
    if (p.exitCode !== 0) return [];
    return h.parse(p.stdout.toString()).map((m) => ({ harness: h.name, ...m }));
  } catch {
    return [];
  }
}

/** Every model the installed harnesses offer. A harness that is missing or fails adds nothing. */
export function readRegistry(list: Harness[] = harnesses()): ModelEntry[] {
  return list.flatMap(listOne);
}

interface ModelFacts {
  company?: string;
  tier?: string;
  cost?: number;
}

/**
 * `models.json`: facts per `provider/name` model, per provider, or per family (a pattern matched against the model's
 * name). The model's own entry wins over a family, a family over its provider; later families win over earlier ones.
 */
export interface ModelFile {
  models: Record<string, ModelFacts>;
  providers: Record<string, ModelFacts>;
  families: Record<string, ModelFacts>;
}

/** Tiers, best first. A model with none is "lower": it never ranks above one that is known to be good. */
const TIERS = ["top", "high", "upper", "good", "mid", "fair", "lower", "small"];
const DEFAULT_TIER = "lower";

export type Described = ModelEntry & ModelFacts;

function validPattern(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function factsProblem(where: string, v: unknown): string {
  if (!isRecord(v)) return `${where} is not an object`;
  for (const key of ["company", "tier"]) if (key in v && (typeof v[key] !== "string" || v[key] === "")) return `${where}.${key} is not a name`;
  if ("tier" in v && !TIERS.includes(v.tier as string)) return `${where}.tier is not one of ${TIERS.join(", ")}`;
  if ("cost" in v && (typeof v.cost !== "number" || !(v.cost >= 0))) return `${where}.cost is not a number`;
  return "";
}

/** The file's facts, or what is wrong with it. A file that is missing is fine; a malformed one gives nothing. */
export function readModelFile(dataDir: string): { file: ModelFile; problem: string } {
  const empty: ModelFile = { models: {}, providers: {}, families: {} };
  const path = `${dataDir}/models.json`;
  if (!existsSync(path)) return { file: empty, problem: "" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { file: empty, problem: `${path} is not valid JSON: ${(e as Error).message}` };
  }
  if (!isRecord(raw)) return { file: empty, problem: `${path} is not an object` };
  const file: ModelFile = { models: {}, providers: {}, families: {} };
  for (const section of ["models", "providers", "families"] as const) {
    const part = raw[section] ?? {};
    if (!isRecord(part)) return { file: empty, problem: `${path}: "${section}" is not an object` };
    for (const [id, facts] of Object.entries(part)) {
      const bad = factsProblem(`${path}: ${section}.${id}`, facts);
      if (bad) return { file: empty, problem: bad };
      if (section === "families" && !validPattern(id)) return { file: empty, problem: `${path}: families.${id} is not a pattern` };
      file[section][id] = facts as ModelFacts;
    }
  }
  return { file, problem: "" };
}

/** The facts of one model: its provider's, then each matching family's, then its own entry. */
function factsOf(m: ModelEntry, file: ModelFile): ModelFacts {
  const families = Object.entries(file.families)
    .filter(([pattern]) => new RegExp(pattern).test(m.name))
    .map(([, f]) => f);
  const own = file.models[`${m.provider}/${m.name}`];
  // A small model stays small whichever file named its family, so a family added later cannot lift its mini.
  const small = own?.tier === undefined && families.some((f) => f.tier === "small") ? { tier: "small" } : {};
  return Object.assign({}, file.providers[m.provider], ...families, small, own);
}

/** The registry with the file's facts merged over it. A model with no entry stays as it is. */
export function describe(registry: ModelEntry[], file: ModelFile): Described[] {
  return registry.map((m) => ({ ...m, ...factsOf(m, file) }));
}

/** The company of a model: the file's word, else the provider's own group, so unknown providers never share one (a provider named `x-y` groups with `x`). */
export const companyOf = (m: Described): string => m.company ?? m.provider.replace(/-.*$/, "");

/** 0 is the best tier. */
export const tierRank = (m: Described): number => TIERS.indexOf(m.tier ?? DEFAULT_TIER);

/** The shipped facts under the data folder's own `models.json`, which wins entry by entry. */
export function modelFile(dir: string): ModelFile {
  const base = readModelFile(join(import.meta.dir, "..", "templates")).file;
  const own = readModelFile(dir).file;
  return { models: { ...base.models, ...own.models }, providers: { ...base.providers, ...own.providers }, families: { ...base.families, ...own.families } };
}

const entryOf = (model: string): ModelEntry => {
  const cut = model.indexOf("/");
  return { harness: "", provider: cut < 0 ? model : model.slice(0, cut), name: cut < 0 ? model : model.slice(cut + 1) };
};

/** The model a `provider/name` string stands for, with the facts the file gives it. */
export const describeOne = (model: string, file: ModelFile): Described => describe([entryOf(model)], file)[0] as Described;

/** The company behind a `provider/model` name, so a reviewer can be picked from another one. */
export const companyOfModel = (model: string, file: ModelFile): string => companyOf(describeOne(model, file));
