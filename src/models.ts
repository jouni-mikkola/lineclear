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

/** `provider/id` of every model pi offers, asked over its RPC (one JSON line in, one out), or undefined when it does not answer. */
export function readOfferedRpc(env: NodeJS.ProcessEnv = process.env): Set<string> | undefined {
  try {
    const p = Bun.spawnSync([env.PI_BIN ?? "pi", "--mode", "rpc", "--no-session"], {
      stdin: Buffer.from(`${JSON.stringify({ id: "models", type: "get_available_models" })}\n`),
      stderr: "ignore",
      timeout: 20_000,
    });
    for (const line of p.stdout.toString().split("\n")) {
      const r = JSON.parse(line.trim() || "{}") as { command?: string; success?: boolean; data?: { models?: { provider?: string; id?: string }[] } };
      if (r.command !== "get_available_models" || !r.success) continue;
      const models = (r.data?.models ?? []).flatMap((m) => (m.provider && m.id ? [`${m.provider}/${m.id}`] : []));
      return models.length > 0 ? new Set(models) : undefined;
    }
  } catch {}
  return undefined;
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

/* ---------- what pi takes, for the + menu, Settings and task add ---------- */

export interface Model {
  /** what the CLI takes: provider/model-code */
  id: string;
  /** what the screen says */
  label: string;
  /** the effort levels it takes, lowest first */
  efforts: string[];
}

export interface CliModels {
  /** what the menus offer, in the registry's order */
  models: Model[];
  /** every level the CLI takes */
  efforts: string[];
}

/** every level any model takes, lowest first; off and none are the same, lowest is the old name for the lowest level */
const RANK: Record<string, number> = { off: 0, none: 0, lowest: 1, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6, ultra: 7 };
export const LEVELS = Object.keys(RANK);

/** the levels pi takes, the one CLI Lineclear passes a model and effort to */
const PI_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const STALE = 6 * 3_600_000;
const TEST = process.env.NODE_ENV === "test";

/** what the installed harnesses offer, read again every few hours */
let registry: ModelEntry[] = [];
let registryAt = 0;
let readEntries: () => ModelEntry[] = TEST ? () => [] : readRegistry;
// every snapshot asks for the same list: it is worked out once for each read of the registry
let listedFor: { registry: ModelEntry[]; models?: CliModels } = { registry: [] };

function askRegistry() {
  if (Date.now() - registryAt < STALE) return;
  const first = registryAt === 0;
  registryAt = Date.now();
  // the first read is waited for: a fresh server must not answer "no models" to the first start
  if (first) registry = readEntries();
  else
    setTimeout(() => {
      registry = readEntries();
    }, 0);
}

/** what pi takes, from the registry; nothing for a CLI Lineclear passes no model or effort to */
export function modelsOf(kind: string): CliModels | undefined {
  if (kind !== "pi") return undefined;
  askRegistry();
  if (listedFor.registry !== registry) {
    const found = registry.filter((m) => m.harness === kind);
    const names = found.map((m) => m.name);
    const models = found.map((m) => ({
      id: `${m.provider}/${m.name}`,
      // a model's own name, unless another provider has one so named too
      label: names.indexOf(m.name) === names.lastIndexOf(m.name) ? m.name : `${m.provider}/${m.name}`,
      efforts: PI_LEVELS,
    }));
    listedFor = { registry, models: { models, efforts: PI_LEVELS } };
  }
  return listedFor.models;
}

/** a model by its id or its name on screen, any case, or without its provider; nothing when pi doesn't have it, or can't
 *  tell (before it was asked) */
export function findModel(kind: string, value?: string): Model | undefined {
  const v = value?.trim().toLowerCase();
  const c = modelsOf(kind);
  if (!v || v === "default" || !c) return undefined;
  return c.models.find((m) => m.id.toLowerCase() === v || m.label.toLowerCase() === v) ?? c.models.find((m) => m.id.toLowerCase().endsWith(`/${v}`));
}

/** whether this CLI can say which models it has: else any model id goes */
export const knowsModels = (kind: string) => !!modelsOf(kind)?.models.length;

/** the model as the CLI takes it: its id, or what was written when the CLI can't tell */
export function modelArg(kind: string, value?: string): string | undefined {
  if (!value || value === "default") return undefined;
  return findModel(kind, value)?.id ?? value;
}

/** the levels this model takes (the CLI's own, for its default model or one it can't tell about) */
export function effortsOf(kind: string, model?: string): string[] {
  const c = modelsOf(kind);
  if (!c) return [];
  return (model ? findModel(kind, model)?.efforts : undefined) ?? c.efforts;
}

/** the level nearest to this one among these, a tie going to the lower; nothing for the CLI's own or an unknown word */
export function nearest(levels: string[], effort?: string): string | undefined {
  const e = effort?.trim().toLowerCase();
  if (!e || e === "default" || !levels.length) return undefined;
  if (levels.includes(e)) return e;
  const r = RANK[e];
  if (r === undefined) return undefined;
  return levels.reduce((best, l) => (Math.abs((RANK[l] ?? 0) - r) < Math.abs((RANK[best] ?? 0) - r) ? l : best));
}

/** an effort as this CLI and model take it: the nearest level it has, or nothing for its own default */
export const effortFor = (kind: string, effort?: string, model?: string) => nearest(effortsOf(kind, model), effort);

/** the machine's first available model of a CLI that lists its models, for a start that has none set */
export function firstModel(kind: string): string | undefined {
  return modelsOf(kind)?.models[0]?.id;
}

/** why a CLI that lists its models won't start without one: no model is picked for it by default */
export function chooseModel(kind: string, model?: string): string | undefined {
  const c = modelsOf(kind);
  if (!c?.models.length || findModel(kind, model)) return undefined;
  return `No model is set for ${kind}. Choose one of: ${c.models.map((m) => m.id).join(", ")}.`;
}

/** for tests: how a fresh server reads the harnesses, before any read happened */
export function setRegistryReader(read: () => ModelEntry[]) {
  readEntries = read;
  registry = [];
  registryAt = 0;
}

/** for tests: what the harnesses offered */
export function setRegistry(entries: ModelEntry[]) {
  registry = entries;
  registryAt = Date.now();
}
