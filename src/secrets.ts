import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir } from "../pi/config.ts";
import { dataDir } from "./paths.ts";
import { listProjectNames, readSettings } from "./project.ts";
import { quote } from "./ssh.ts";
import { parseTotpKey, totpCode } from "./totp.ts";

type Env = Record<string, string | undefined>;

const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;

const ownerFile = (env: Env) => join(configDir(env), "owner.env");
// Where the server keeps it: a worker for another machine runs on the main one and reads the main one's vault.
const vaultHome = (env: Env) => env.LINECLEAR_MAIN_HOME || dataDir(env);
const vaultFile = (env: Env) => join(vaultHome(env), "vault.json");

/** Reads NAME='value' lines. A value may run over lines. A line that does not fit is skipped. */
function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const line = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=((?:'(?:[^']|'\\'')*'|[^\s'"]*))\s*$/gm;
  for (const m of text.matchAll(line)) {
    const raw = m[2]!;
    out[m[1]!] = raw.startsWith("'") ? raw.slice(1, -1).replace(/'\\''/g, "'") : raw;
  }
  return out;
}

function readEnvFile(file: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

const envText = (all: Record<string, string>) =>
  Object.keys(all)
    .sort()
    .map((k) => `${k}=${quote(all[k] ?? "")}\n`)
    .join("");

/** The server's vault: each level's secrets by name. Its format is the server's (server/server/live/secrets.ts). */
type Vault = Record<string, Record<string, { value: string; at: number }>>;

/** The vault as it is. One that cannot be read throws, so a save never takes it for empty and loses its secrets. */
function readVault(env: Env): Vault {
  let text: string;
  try {
    text = readFileSync(vaultFile(env), "utf8");
  } catch {
    return {};
  }
  try {
    return JSON.parse(text) as Vault;
  } catch (e) {
    throw new Error(`the vault cannot be read (${vaultFile(env)}: ${(e as Error).message}); nothing was changed`);
  }
}

function readVaultQuietly(env: Env): Vault {
  try {
    return readVault(env);
  } catch {
    return {};
  }
}

/** This machine's name as the server keeps it: the short host name, or the label of the machine a worker runs for. */
const host = (env: Env) => (env.LINECLEAR_MACHINE ?? hostname()).replace(/^.*@/, "").split(".")[0] ?? "";
const machineLevel = (env: Env) => `m:${host(env)}`;
const spaceLevel = (space: string, env: Env) => `p:${host(env)}:${space}`;

function spaceOfProject(project: string, env: Env): string | undefined {
  const s = readSettings(project, env as NodeJS.ProcessEnv);
  return typeof s === "string" ? undefined : s.space;
}

/**
 * The levels a project's secrets come from, the most specific first: its space, this machine, Everywhere.
 * For another machine its own levels lead, then this machine's space, where 'secrets set <project>' writes.
 */
function chainOf(project: string | undefined, env: Env, machine?: string): string[] {
  const there = machine === undefined ? env : { ...env, LINECLEAR_MACHINE: machine };
  const space = project === undefined ? undefined : spaceOfProject(project, env);
  const spaces = space === undefined ? [] : [...new Set([spaceLevel(space, there), spaceLevel(space, env)])];
  return [...spaces, machineLevel(there), "all"];
}

/** Every name the project's chain reaches, with its value, the most specific level winning. */
function valuesOf(project: string | undefined, env: Env, machine?: string): Record<string, string> {
  const vault = readVaultQuietly(env);
  const out: Record<string, string> = {};
  for (const level of chainOf(project, env, machine).reverse()) for (const [n, k] of Object.entries(vault[level] ?? {})) out[n] = k.value;
  return out;
}

const gitCommonDir = (cwd: string): string | undefined => {
  try {
    const dir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return realpathSync(dir);
  } catch {
    return undefined;
  }
};

/** The project whose repo this folder belongs to (the repo itself or one of its worktrees), or undefined. */
function projectOfDir(cwd: string, env: Env = process.env): string | undefined {
  const here = gitCommonDir(cwd);
  if (here === undefined) return undefined;
  for (const name of listProjectNames(env as NodeJS.ProcessEnv)) {
    const s = readSettings(name, env as NodeJS.ProcessEnv);
    if (typeof s !== "string" && gitCommonDir(s.repo) === here) return name;
  }
  return undefined;
}

/** A project's secrets as an env file, for sending to another machine over SSH. Empty when it has none. */
export function secretsText(project: string, env: Env = process.env, machine?: string): string {
  return envText(valuesOf(project, env, machine));
}

/** The names a task of the project can load. */
export function secretNames(project: string, env: Env = process.env): string[] {
  return Object.keys(valuesOf(project, env)).sort();
}

/** Whether the text names the login (`M365_GA` as "m365 ga" or "M365_GA"), as a whole word. */
const mentions = (text: string, login: string) => new RegExp(`(^|[^a-z0-9])${login.toLowerCase().replace(/_/g, "[ _]")}($|[^a-z0-9])`).test(text.toLowerCase());

/** The logins whose NAME_TOTP is stored for the project. */
export function loadableTotps(project: string | undefined, env: Env = process.env): string[] {
  return (project === undefined ? [] : secretNames(project, env))
    .filter((n) => n.endsWith("_TOTP"))
    .map((n) => n.slice(0, -5))
    .sort();
}

/** The name of the one stored `NAME_USER` and `NAME_PASSWORD` pair that the question names as a whole word. */
export function storedLogin(question: string, names: string[]): string | undefined {
  const found = names
    .filter((n) => n.endsWith("_USER") && names.includes(n.replace(/_USER$/, "_PASSWORD")))
    .map((n) => n.replace(/_USER$/, ""))
    .filter((l) => l.length >= 3 && mentions(question, l));
  return found.length === 1 ? found[0] : undefined;
}

/**
 * The logins that make a question to the owner needless: those it names, or, when it names no login, every one with
 * a stored TOTP. Empty when the owner has to be asked.
 */
export function totpAnswers(question: string, logins: string[], named?: string): string[] {
  // a captcha is the owner's whatever the login has stored
  if (/\bcaptcha\b/i.test(question)) return [];
  const hit = logins.filter((l) => l === named || mentions(question, l));
  return hit.length > 0 ? hit : named === undefined ? logins : [];
}

/** What an agent does when a login is stored (a USER and PASSWORD pair the question names), instead of asking the owner. */
const loginAdvice = (name: string, totp: boolean) =>
  `a stored login exists: ${name}; use ${name}_USER and ${name}_PASSWORD with lineclear secret run, without printing them${totp ? `, code from lineclear totp ${name}` : ""}. The owner is not asked.`;

/**
 * Why a wait or a question to the owner about a login is needless: the stored login (secret names only, never
 * values) the agent can use instead. Undefined when none matches and the owner has to be asked.
 */
export function storedLoginAdvice(text: string, project: string | undefined, env: Env = process.env, named?: string): string | undefined {
  const totps = loadableTotps(project, env);
  const pair = named === undefined ? storedLogin(text, project === undefined ? [] : secretNames(project, env)) : undefined;
  if (pair !== undefined && !/\bcaptcha\b/i.test(text)) return loginAdvice(pair, totps.includes(pair));
  const stored = totpAnswers(text, totps, named);
  return stored.length > 0 ? totpAdvice(stored) : undefined;
}

/** What an agent does when a login has a stored TOTP, instead of asking the owner. */
export const totpAdvice = (logins: string[]) =>
  `${logins.map((l) => `${l}_TOTP`).join(", ")} is stored, so the owner is not asked. Never wait for a push or a number: choose the verification-code option ("Sign in another way" > "Use a verification code") and fill the code from \`lineclear totp ${logins[0]}\` in the same command, without printing it.`;

/** What a task of `project` may not see: the owner-only names and every name kept where its chain does not reach. */
function forbidden(project: string | undefined, env: Env) {
  const own = new Set(Object.keys(valuesOf(project, env)));
  const chain = new Set(chainOf(project, env));
  const names = new Set<string>(Object.keys(readEnvFile(ownerFile(env))));
  for (const [level, all] of Object.entries(readVaultQuietly(env))) if (!chain.has(level)) for (const n of Object.keys(all)) names.add(n);
  for (const n of own) names.delete(n);
  return { names: [...names].sort() };
}

/** `text` with every stored secret value replaced by ***. */
export function maskSecrets(text: string, env: Env = process.env): string {
  const values = [
    ...Object.values(readEnvFile(ownerFile(env))),
    ...Object.values(readVaultQuietly(env)).flatMap((all) => Object.values(all).map((k) => k.value)),
  ]
    .filter((v) => v !== "")
    .sort((a, b) => b.length - a.length);
  for (const v of values) text = text.split(v).join("***");
  return text;
}

/** The exit code and the last 20 lines of a failed command's output, secrets masked. */
export function failureTail(code: number | null, output: string, env: Env = process.env): string {
  const text = maskSecrets(output.trimEnd(), env);
  return [`exit ${code}`, ...(text === "" ? [] : text.split("\n").slice(-20))].join("\n");
}

function fail(out: (l: string) => void, message: string, command = "secrets"): number {
  out(`lineclear ${command}: ${message}`);
  return 1;
}

async function readStdin(): Promise<string> {
  return await new Response(Bun.stdin.stream()).text();
}

/** The level `set` writes: owner-only (--owner), Everywhere (--all), this machine (--machine) or the project's space. */
function setLevel(rest: string[], env: Env): { level: string; label: string; name: string } | string {
  const [first, name] = rest;
  if (rest.length !== 2 || first === undefined || name === undefined) return "usage";
  if (first === "--owner") return { level: "owner", label: "you only", name };
  if (first === "--all") return { level: "all", label: "Everywhere", name };
  if (first === "--machine") return { level: machineLevel(env), label: `this machine (${host(env)})`, name };
  if (!listProjectNames(env as NodeJS.ProcessEnv).includes(first)) return `no project named '${first}'`;
  const space = spaceOfProject(first, env);
  if (space === undefined) return `the settings of '${first}' name no space`;
  return { level: spaceLevel(space, env), label: `'${first}'`, name };
}

async function setSecret(rest: string[], out: (l: string) => void, env: Env, readValue: () => Promise<string>): Promise<number> {
  const target = setLevel(rest, env);
  if (target === "usage") return fail(out, "usage: lineclear secrets set <project> | --machine | --all | --owner <NAME> (the value on stdin)");
  if (typeof target === "string") return fail(out, target);
  if (!SECRET_NAME.test(target.name)) return fail(out, `'${target.name}' is not a usable name (letters, numbers and _, not starting with a number)`);
  const value = (await readValue()).replace(/\r?\n$/, "");
  if (value === "") return fail(out, "the value on stdin is empty");
  if (target.level === "owner") {
    const all = { ...readEnvFile(ownerFile(env)), [target.name]: value };
    mkdirSync(configDir(env), { recursive: true });
    writeAtomic(ownerFile(env), envText(all), { mode: 0o600 });
    out(`saved ${target.name} for you only`);
    return 0;
  }
  const saved = saveToVault(target.level, { [target.name]: value }, env);
  if (saved !== undefined) return fail(out, saved);
  out(`saved ${target.name} for ${target.label}`);
  return 0;
}

/** Writes values into one vault level. Returns what went wrong, or undefined. */
function saveToVault(level: string, values: Record<string, string>, env: Env): string | undefined {
  let vault: Vault;
  try {
    vault = readVault(env);
  } catch (e) {
    return (e as Error).message;
  }
  const at = Date.now();
  const names = vault[level] ?? {};
  for (const [name, value] of Object.entries(values)) names[name] = { value, at };
  vault[level] = names;
  mkdirSync(vaultHome(env), { recursive: true, mode: 0o700 });
  writeAtomic(vaultFile(env), JSON.stringify(vault, null, 2), { mode: 0o600 });
  return undefined;
}

/** `secrets import <space>`: an env file on stdin goes into the vault level of the space, as spread.ts sends a project's secrets to another machine. */
async function importSecrets(space: string, out: (l: string) => void, env: Env, readValue: () => Promise<string>): Promise<number> {
  const values = parseEnvFile(await readValue());
  const saved = saveToVault(spaceLevel(space, env), values, env);
  if (saved !== undefined) return fail(out, saved);
  out(`saved ${Object.keys(values).length} secrets for space '${space}'`);
  return 0;
}

/**
 * `secrets adopt <dir>`: moves an old env tree into the vault, for the owner to run once. `common.env` goes Everywhere,
 * `machine/*.env` to this machine, `<owner>/<repo>.env` to the space of the project named <repo>. Prints counts and the
 * names of files with no project, never a value.
 */
function adoptTree(dir: string, out: (l: string) => void, env: Env): number {
  const root = resolve(dir);
  const files = (d: string) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".env")) : []);
  const projects = listProjectNames(env as NodeJS.ProcessEnv);
  const jobs: { level: string; label: string; file: string }[] = [];
  if (existsSync(join(root, "common.env"))) jobs.push({ level: "all", label: "Everywhere", file: join(root, "common.env") });
  for (const f of files(join(root, "machine"))) jobs.push({ level: machineLevel(env), label: "this machine", file: join(root, "machine", f) });
  for (const owner of existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "machine") : []) {
    for (const f of files(join(root, owner.name))) {
      const project = f.replace(/\.env$/, "");
      const space = projects.includes(project) ? spaceOfProject(project, env) : undefined;
      if (space === undefined) out(`skipped ${owner.name}/${f}: no project named '${project}'`);
      else jobs.push({ level: spaceLevel(space, env), label: `'${project}'`, file: join(root, owner.name, f) });
    }
  }
  for (const j of jobs) {
    const values = readEnvFile(j.file);
    const saved = saveToVault(j.level, values, env);
    if (saved !== undefined) return fail(out, saved);
    out(`saved ${Object.keys(values).length} secrets for ${j.label}`);
  }
  return 0;
}

export async function secrets(
  args: string[],
  out: (l: string) => void,
  env: Env = process.env,
  readValue: () => Promise<string> = readStdin,
  cwd: string = process.cwd(),
): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "set") return setSecret(rest, out, env, readValue);
  if (sub === "import" && rest.length === 1) return importSecrets(rest[0] ?? "", out, env, readValue);
  if (sub === "adopt" && rest.length === 1) return adoptTree(rest[0] ?? "", out, env);
  if (sub === "list" && rest.length === 1) {
    const project = rest[0]!;
    if (!listProjectNames(env as NodeJS.ProcessEnv).includes(project)) return fail(out, `no project named '${project}'`);
    for (const n of secretNames(project, env)) out(n);
    return 0;
  }
  if (sub === "env" && rest.length === 0) {
    const all = valuesOf(projectOfDir(resolve(cwd), env), env);
    for (const k of Object.keys(all).sort()) out(`export ${k}=${quote(all[k] ?? "")}`);
    return 0;
  }
  if (sub === "deny" && rest.length === 0) {
    // For the pi extension, which runs apart from this code: what a task in this folder may not see.
    out(JSON.stringify(forbidden(projectOfDir(resolve(cwd), env), env)));
    return 0;
  }
  out(
    "usage: lineclear secrets set <project> | --machine | --all | --owner <NAME> (value on stdin) | list <project> | env | adopt <old env folder> (import and deny are for Lineclear itself)",
  );
  return 2;
}

/** `lineclear totp NAME`: the current code of the login NAME, from NAME_TOTP in this folder's secrets. */
export function totp(args: string[], out: (l: string) => void, env: Env = process.env, cwd: string = process.cwd(), now: number = Date.now()): number {
  const raw = args[0];
  if (args.length !== 1 || raw === undefined || raw.startsWith("-")) {
    out("usage: lineclear totp NAME   (prints the code of NAME_TOTP from this folder's secrets)");
    return 2;
  }
  const variable = `${raw.toUpperCase().replace(/_TOTP$/, "")}_TOTP`;
  if (!SECRET_NAME.test(variable)) return fail(out, `'${raw}' is not a login name`, "totp");
  const value = valuesOf(projectOfDir(resolve(cwd), env), env)[variable] ?? env[variable];
  if (value === undefined || value.trim() === "") return fail(out, `${variable} is not kept for this folder (Settings > Secrets)`, "totp");
  try {
    out(totpCode(parseTotpKey(value), now));
    return 0;
  } catch {
    return fail(out, `${variable} is not a TOTP key (base32 or an otpauth:// address)`, "totp");
  }
}
