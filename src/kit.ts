import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { piDir } from "./paths.ts";
import { parts } from "./pack.ts";

type Env = Record<string, string | undefined>;

/** What one machine loads into pi. */
export interface Kit {
  pi: string | null;
  packages: { name: string; spec: string; version: string | null }[];
  extensions: { name: string; owner: string }[];
  skills: string[];
  parts: { name: string; on: boolean }[];
}

/** What the release expects of every machine: `pi/kit.json`. */
export interface Wanted {
  /** Empty: any version. */
  pi: string;
  packages: Record<string, string>;
  /** The only owners an extension may have. */
  owners: string[];
  /** What was tried or decided about the kit and why, as it shows in docs/kit.md. */
  decisions?: string[];
}

export const APP = join(import.meta.dir, "..");

/** The release's kit: `pi/kit.json`, or the file LINECLEAR_KIT names (a test's machine has no real pi to match). */
export const wantedKit = (app = APP, env: Env = process.env): Wanted => JSON.parse(readFileSync(env.LINECLEAR_KIT || join(app, "pi", "kit.json"), "utf8"));

/** Whose an extension is: Lineclear's, herdr's (its file says so), or one of the other set. */
export function ownerOf(file: string, text: string): string {
  if (file === "lineclear.ts") return "Lineclear";
  if (text.includes("installed by herdr")) return "herdr";
  return "other";
}

/** The package name in `npm:name@1.2.3` or `npm:name`. */
const packageName = (spec: string) => /^npm:(@?[^@]+)/.exec(spec)?.[1] ?? spec;

const stringOr = (v: unknown): string | null => (typeof v === "string" ? v : null);

const json = (file: string): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

/** What pi on this machine really loads, read from its folders and `pi --version`. */
export function readKit(env: Env = process.env, piVersion: () => string | null = realPiVersion): Kit {
  const dir = piDir(env);
  const packages = ((json(join(dir, "settings.json"))?.packages ?? []) as unknown[])
    .filter((p): p is string => typeof p === "string")
    .map((spec) => {
      const name = packageName(spec);
      return { name, spec, version: stringOr(json(join(dir, "npm", "node_modules", name, "package.json"))?.version) };
    });
  const extDir = join(dir, "extensions");
  const extensions = existsSync(extDir)
    ? readdirSync(extDir, { withFileTypes: true })
        .filter((e) => e.name !== "shared" && !e.name.endsWith(".json") && (e.isDirectory() || e.name.endsWith(".ts")))
        .map((e) => {
          const name = e.name.replace(/\.ts$/, "");
          const text = e.isFile() ? readFileSync(join(extDir, e.name), "utf8").slice(0, 400) : "";
          return { name, owner: ownerOf(e.name, text) };
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const home = env.HOME ?? homedir();
  const skills = [join(dir, "skills"), join(home, ".agents", "skills")]
    .flatMap((d) =>
      existsSync(d)
        ? readdirSync(d, { withFileTypes: true })
            .filter((e) => e.isDirectory() || e.isSymbolicLink())
            .map((e) => e.name)
        : [],
    )
    .sort();
  return { pi: piVersion(), packages, extensions, skills: [...new Set(skills)], parts: parts(env) };
}

function realPiVersion(): string | null {
  try {
    const p = Bun.spawnSync(["pi", "--version"], { stdin: "ignore" });
    return p.exitCode === 0 ? (`${p.stdout}${p.stderr}`.match(/\d+\.\d+\.\d+\S*/)?.[0] ?? null) : null;
  } catch {
    return null;
  }
}

/** How a machine's kit differs from the release's, one line each; none when it matches. */
export function kitDiff(kit: Kit, want: Wanted): string[] {
  const out: string[] = [];
  if (want.pi && kit.pi !== want.pi) out.push(`pi is ${kit.pi ?? "missing"}, the release wants ${want.pi}`);
  for (const [name, version] of Object.entries(want.packages)) {
    const have = kit.packages.find((p) => p.name === name);
    if (!have || have.version !== version) out.push(`${name} is ${have?.version ?? "missing"}, the release wants ${version}`);
  }
  for (const p of kit.packages) if (!(p.name in want.packages)) out.push(`${p.name} is not in the release's kit`);
  // an extension Lineclear did not install is the owner's own: kitOthers names it, it is never a fix
  for (const e of kit.extensions)
    if (e.owner !== "other" && !want.owners.includes(e.owner)) out.push(`extension ${e.name} (${e.owner}) is not in the release's kit`);
  return out;
}

/** The extensions Lineclear did not install: the owner's own, listed for information. */
export const kitOthers = (kit: Kit): string[] => kit.extensions.filter((e) => e.owner === "other").map((e) => e.name);

export type Effect = {
  part: string;
  on: { perStep: number; tokens: number; steps: number } | null;
  off: { perStep: number; tokens: number; steps: number } | null;
};

const money = (v: Effect["on"]) => (v ? `$${v.perStep.toFixed(2)}, ${Math.round(v.tokens)} tokens (${v.steps} steps)` : "not measured");

/** The kit as docs/kit.md: one section per machine, then the measured effect of each part. */
export function kitMarkdown(machines: { name: string; kit: Kit | null }[], want: Wanted, fx: Effect[], since?: string, notes: string[] = []): string {
  const out = ["# The agent kit", "", "Generated by `lineclear kit --write`. Do not edit by hand.", ""];
  out.push(
    `The release wants pi ${want.pi} and these packages: ${Object.entries(want.packages)
      .map(([n, v]) => `${n} ${v}`)
      .join(", ")}.`,
    "",
  );
  for (const { name, kit } of machines) {
    out.push(`## ${name}`, "");
    if (!kit) {
      out.push("Could not be read.", "");
      continue;
    }
    const diff = kitDiff(kit, want);
    out.push(diff.length === 0 ? "Matches the release." : `Differs from the release:\n${diff.map((d) => `- ${d}`).join("\n")}`, "");
    out.push(`- pi: ${kit.pi ?? "not found"}`);
    out.push(`- packages: ${kit.packages.map((p) => `${p.name} ${p.version ?? "not installed"}`).join(", ") || "none"}`);
    out.push(`- extensions: ${kit.extensions.map((e) => `${e.name} (${e.owner})`).join(", ") || "none"}`);
    out.push(`- skills: ${kit.skills.join(", ") || "none"}`);
    out.push(`- pack parts: ${kit.parts.map((p) => `${p.name} ${p.on ? "on" : "off"}`).join(", ") || "none"}`, "");
  }
  out.push(`## Measured effect of each pack part${since ? ` (since ${since})` : ""}`, "", "Per merged step, from `lineclear measure`.", "");
  if (fx.length === 0) out.push("Not measured here: run `lineclear kit --write <project>` on the machine that holds the project's sessions.");
  else {
    out.push("| part | on | off |", "| --- | --- | --- |");
    for (const x of fx) out.push(`| ${x.part} | ${money(x.on)} | ${money(x.off)} |`);
  }
  out.push("", ...notes.map((n) => `- ${n}`), "", "## Decisions", "", ...(want.decisions ?? []).map((d) => `- ${d}`), "");
  return out.join("\n");
}
