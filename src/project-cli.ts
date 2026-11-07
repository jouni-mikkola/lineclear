import { existsSync, statSync } from "node:fs";
import { addProject, fail, removeProject, setProject } from "./project-write.ts";
import { askBefore, askBeforeKeys, type Ask, listProjectNames, NAME, readSettings, roles, tierNames, tiersOf } from "./project.ts";
import { failureTail, maskSecrets, secretNames } from "../server/server/live/secrets.ts";

/** Each project with its commands, its model lists and its secret names, never their values. */
export function listProjects(out: (l: string) => void, env = process.env): number {
  const names = listProjectNames(env);
  if (names.length === 0) out("no projects, add one with 'lineclear project add <repo>'");
  for (const n of names) {
    const s = readSettings(n, env);
    if (typeof s === "string") {
      out(`${n}  (${s})`);
      continue;
    }
    out(`${n}  ${s.repo}  space ${s.space}  ${s.paused ? "Paused" : "Running"}`);
    out(`  check     ${s.check}`);
    if (s.health) out(`  health    ${s.health}`);
    if (s.heavy?.length) out(`  heavy     ${s.heavy.join(" | ")}`);
    const tiers = tiersOf(s);
    for (const t of tierNames) out(`  ${t.padEnd(10)}${tiers[t].commands.join(" | ") || "(none)"}  (budget ${tiers[t].budgetS} s)`);
    const ab = askBefore(s);
    out(`  ask me before  ${askBeforeKeys.map((k) => `${k} ${ab[k] ? "on" : "off"}`).join(", ")}`);
    for (const role of roles) out(`  ${role.padEnd(10)}${(s.models?.[role] ?? []).join(", ") || "(none)"}`);
    const secrets = secretNames(n, env);
    if (secrets.length) out(`  secrets   ${secrets.join(", ")}`);
  }
  return 0;
}

function checkProject(name: string, out: (l: string) => void, env = process.env): number {
  const s = NAME.test(name) ? readSettings(name, env) : `no project named '${name}'`;
  if (typeof s === "string") return fail(out, s);
  if (!existsSync(s.repo) || !statSync(s.repo).isDirectory()) return fail(out, `repo is missing: ${s.repo}`);
  out(`repo exists: ${s.repo}`);
  const p = Bun.spawnSync(["sh", "-c", s.check], { cwd: s.repo, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) {
    out(`lineclear project: check command failed: ${maskSecrets(s.check, env)}`);
    out(failureTail(p.exitCode, `${p.stdout}${p.stderr}`, env));
    return 1;
  }
  out(`check command runs: ${s.check}`);
  return 0;
}

export async function project(args: string[], ask: Ask, out: (l: string) => void, env = process.env): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "add") return addProject(rest, ask, out, env);
  if (sub === "list" && rest.length === 0) return listProjects(out, env);
  if (sub === "set") return setProject(rest, out, env);
  if (sub === "remove" && rest.length === 1) return removeProject(rest[0]!, out, env);
  if (sub === "check" && rest.length === 1) return checkProject(rest[0]!, out, env);
  out("usage: lineclear project add <repo> | list | set <name> | remove <name> | check <name>");
  return 2;
}
