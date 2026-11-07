import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { sendToDispatcher } from "./chat.ts";
import { serverBin } from "./paths.ts";
import { currentModelFile } from "./company.ts";
import { companyOfModel, describeOne, type ModelFile, tierRank } from "./models.ts";
import { detectCheck, detectSpace } from "./project-detect.ts";
import { addProject } from "./project-write.ts";
import { listProjectNames, readSettings } from "./project.ts";

type Env = Record<string, string | undefined>;

/** What `lineclear project add` finds in a repo folder, for Home to show and start. */
export interface Detected {
  repo: string;
  name: string;
  space?: string;
  check?: string;
  /** Whether docs/ROADMAP.md exists. Without one, Start has a first roadmap written. */
  roadmap: boolean;
  /** The models to start from, best first: another project's workers, else the best that pi offers. */
  models: string[];
}

/** Best tier first, from the registry's facts. */
const rank = (m: string, file: ModelFile) => tierRank(describeOne(m, file));

/**
 * Three models from those pi offers, best first, the second from another company when one is offered, so a reviewer
 * never checks its own company's work when it need not.
 */
export function pickModels(offered: string[], file: ModelFile = currentModelFile()): string[] {
  // newer versions first within a tier: names sort by their numbers
  const sorted = [...new Set(offered)].sort((a, b) => rank(a, file) - rank(b, file) || b.localeCompare(a, "en", { numeric: true }));
  const best = sorted[0];
  if (best === undefined) return [];
  const other = sorted.find((m) => companyOfModel(m, file) !== companyOfModel(best, file));
  const picked = other ? [best, other] : [best];
  return [...picked, ...sorted.filter((m) => !picked.includes(m))].slice(0, 3);
}

/** The models pi offers: only those of the accounts it is logged in to. */
function offeredModels(env: Env): string[] {
  try {
    const p = Bun.spawnSync([env.PI_BIN ?? "pi", "--list-models"], { env: env as NodeJS.ProcessEnv, stdin: "ignore", stderr: "ignore" });
    if (p.exitCode !== 0) return [];
    return p.stdout
      .toString()
      .split("\n")
      .slice(1)
      .flatMap((line) => {
        const [provider, model] = line.trim().split(/\s+/);
        return provider && model ? [`${provider}/${model}`] : [];
      });
  } catch {
    return [];
  }
}

/** The models to start a new project with: the first project's workers, else the best pi offers. */
function startModels(env: Env): string[] {
  for (const name of listProjectNames(env as NodeJS.ProcessEnv)) {
    const s = readSettings(name, env as NodeJS.ProcessEnv);
    if (typeof s !== "string" && s.models?.worker?.length) return s.models.worker;
  }
  return pickModels(offeredModels(env));
}

/** The repo's folder, resolved, or why it cannot be one. */
function repoFolder(text: string, env: Env): string | { error: string } {
  const repo = resolve(text.trim().replace(/^~(?=\/|$)/, env.HOME ?? homedir()));
  if (!text.trim()) return { error: "Give the folder of a repo." };
  if (!existsSync(repo) || !statSync(repo).isDirectory()) return { error: `There is no folder ${repo}.` };
  if (!existsSync(join(repo, ".git"))) return { error: `${repo} is not a git repo. Lineclear works on git repos: pick the folder that holds .git.` };
  return repo;
}

const projectName = (repo: string) =>
  basename(repo)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/, "");

export function detectProject(text: string, env: Env): Detected | { error: string } {
  const repo = repoFolder(text, env);
  if (typeof repo !== "string") return repo;
  return {
    repo,
    name: projectName(repo),
    space: detectSpace(repo, env as NodeJS.ProcessEnv),
    check: detectCheck(repo),
    roadmap: existsSync(join(repo, "docs", "ROADMAP.md")),
    models: startModels(env),
  };
}

/** Folders where people keep their repos, searched two levels deep. */
const REPO_HOMES = ["code", "src", "projects", "repos", "git", "dev", "work"];

/** The git repos under the usual folders of the home that are no project yet, the most recently changed first. */
export function findRepos(env: Env): { repo: string; name: string }[] {
  const home = env.HOME ?? homedir();
  const taken = new Set(
    listProjectNames(env as NodeJS.ProcessEnv).flatMap((n) => {
      const s = readSettings(n, env as NodeJS.ProcessEnv);
      return typeof s === "string" ? [] : [s.repo];
    }),
  );
  const found: { repo: string; at: number }[] = [];
  const look = (dir: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      if (n.startsWith(".") || n === "node_modules") continue;
      const path = join(dir, n);
      if (existsSync(join(path, ".git"))) found.push({ repo: path, at: statSync(join(path, ".git")).mtimeMs });
      else if (depth > 1 && statSync(path, { throwIfNoEntry: false })?.isDirectory()) look(path, depth - 1);
    }
  };
  for (const d of REPO_HOMES) look(join(home, d), 2);
  return found
    .filter((f) => !taken.has(f.repo))
    .sort((a, b) => b.at - a.at)
    .slice(0, 12)
    .map(({ repo }) => ({ repo, name: basename(repo) }));
}

export interface NewProject {
  repo?: unknown;
  name?: unknown;
  space?: unknown;
  check?: unknown;
  models?: unknown;
}

/** The goal of the planning task that writes a repo's first roadmap. */
export const FIRST_ROADMAP =
  "A first roadmap: read the README and the code, then write docs/ROADMAP.md with at most 8 small steps that make this repo better where it is weakest, the first one done in an hour";

const sentence = (why: string) => {
  const t = why.trim().replace(/^lineclear [a-z]+: /, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) + (t.endsWith(".") ? "" : ".") : "It gave no reason.";
};

/** The repo's space: the one it has, else a new one named like the project. */
function spaceFor(repo: string, name: string, env: Env): string | { error: string } {
  const have = detectSpace(repo, env as NodeJS.ProcessEnv);
  if (have) return have;
  let why = "";
  try {
    const p = Bun.spawnSync([serverBin(env as NodeJS.ProcessEnv), "space", "add", repo, "--name", name], { env: env as NodeJS.ProcessEnv, stdin: "ignore" });
    if (p.exitCode === 0) return detectSpace(repo, env as NodeJS.ProcessEnv) ?? name;
    why = (p.stderr.toString() || p.stdout.toString()).trim().split("\n")[0] ?? "";
  } catch {
    // no board command: the reason below says what to do
  }
  return { error: `The board could not take this repo${why ? `: ${why.replace(/\.$/, "")}` : ""}. Is Lineclear's board running? It starts with Lineclear.` };
}

/**
 * Starts a project as Home's Start does: its space made when it has none, saved where `lineclear project add` saves,
 * and, without a roadmap, the Dispatcher is handed the plan for the first one. Returns the name, or why not in plain words.
 */
export async function saveProject(
  body: NewProject,
  env: Env,
  send: (text: string, env: Env) => Promise<string | undefined> = sendToDispatcher,
): Promise<{ name: string; planning?: boolean } | { error: string; status: number }> {
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const repo = repoFolder(text(body.repo), env);
  if (typeof repo !== "string") return { error: repo.error, status: 400 };
  const models = Array.isArray(body.models) ? body.models.filter((m): m is string => typeof m === "string" && m.trim() !== "").map((m) => m.trim()) : [];
  const name = text(body.name) || projectName(repo);
  if (!text(body.check))
    return { error: "Lineclear found no tests in this repo. Write the command that tests it, such as npm test or make test.", status: 400 };
  if (!models.length) return { error: "pi is logged in to no model yet. Open pi in a terminal, log in with /login, then press Start again.", status: 400 };
  const space = text(body.space) || spaceFor(repo, name, env);
  if (typeof space !== "string") return { error: space.error, status: 502 };
  const said: string[] = [];
  const list = models.join(",");
  const code = await addProject(
    [repo, "--name", name, "--space", space, "--check", text(body.check), "--worker", list, "--reviewer", list],
    null,
    (l) => said.push(l),
    env as NodeJS.ProcessEnv,
  );
  if (code !== 0) {
    const why = said.join(" ");
    return { error: sentence(why), status: why.includes("already exists") ? 409 : 400 };
  }
  // own processes, as the commands: the Dispatcher leans on the loop, whose web pages call this
  const lineclear = (...args: string[]) =>
    Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "bin", "lineclear"), ...args], { env: env as NodeJS.ProcessEnv, stdin: "ignore" });
  // the plan runs as the Dispatcher's own: the command prints its instructions and this function sends them to the chat
  // the chat's Dispatcher comes with the first project; setting it up again changes nothing
  lineclear("dispatcher", "setup");
  if (existsSync(join(repo, "docs", "ROADMAP.md"))) return { name };
  const plan = Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "bin", "lineclear"), "plan", name, FIRST_ROADMAP], {
    env: { ...env, LINECLEAR_ROLE: "dispatcher" } as NodeJS.ProcessEnv,
    stdin: "ignore",
  });
  // the Dispatcher writes the plan: hand it the instructions `lineclear plan` printed
  const failed = plan.exitCode === 0 ? await send(plan.stdout.toString(), env) : `${plan.stdout.toString()} ${plan.stderr.toString()}`;
  if (failed) return { error: `${name} is added, but its first roadmap did not start. ${sentence(failed.replace(/\s+/g, " ").trim())}`, status: 502 };
  return { name, planning: true };
}
