import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import lineclearExtension, { kitSkills, lineclearAgent } from "../pi/extension.ts";
import { tmp } from "./helpers.ts";

// The agent kit: what every Lineclear agent gets from the repo itself, on a machine with no personal setup.

const root = tmp("kit");
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Handler = (event: unknown, ctx: unknown) => unknown;

/** Loads the extension into a stand-in for pi and returns its handlers by event. */
async function load(): Promise<Map<string, Handler[]>> {
  const on = new Map<string, Handler[]>();
  await lineclearExtension({ on: (event, handler) => void on.set(event, [...(on.get(event) ?? []), handler]) });
  return on;
}

/** Runs one event through the extension with this environment, as pi would for an agent. */
async function fire(name: string, event: unknown, env: Record<string, string>): Promise<unknown[]> {
  const was = { ...process.env };
  for (const k of ["LINECLEAR_CHAT", "SHEPHERDR_CHAT", "LINECLEAR_TASK", "LINECLEAR_ROLE"]) delete process.env[k];
  Object.assign(process.env, env);
  try {
    const handlers = (await load()).get(name) ?? [];
    return handlers.map((h) => h(event, {}));
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in was)) delete process.env[k];
    Object.assign(process.env, was);
  }
}

test("an agent with an empty home gets the kit's rules and skills, and nothing names a personal file", async () => {
  const home = join(root, "home");
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(join(home, ".pi", "agent", "AGENTS.md"), "");
  mkdirSync(join(home, ".agents"), { recursive: true });
  const env = { HOME: home, PATH: "/usr/bin:/bin", LINECLEAR_CHAT: "ABC-1/Agent" };

  const sections: Record<string, string> = {};
  await fire("before_agent_start", { systemPromptOptions: { sections } }, env);
  const rules = sections.lineclear_rules ?? "";
  for (const rule of [
    "Never push",
    "Decide yourself",
    "--kind <login|money|outward>",
    "lineclear check",
    "lineclear secrets env",
    "lineclear totp",
    "playwright-cli",
    "find-docs",
  ]) {
    expect(rules).toContain(rule);
  }

  const [found] = (await fire("resources_discover", { type: "resources_discover", cwd: home, reason: "startup" }, env)) as { skillPaths: string[] }[];
  const skills = found?.skillPaths ?? [];
  expect(skills).toEqual([join(import.meta.dir, "..", "kit", "skills")]);
  const [kitSkills = ""] = skills;
  expect(readdirSync(kitSkills)).toContain("find-docs");

  // and every brief Lineclear writes for an agent, from its templates
  const templates = join(import.meta.dir, "..", "templates");
  const briefs = readdirSync(templates).map((f) => readFileSync(join(templates, f), "utf8"));
  const kit = [rules, readFileSync(join(kitSkills, "find-docs", "SKILL.md"), "utf8"), ...briefs].join("\n");
  for (const personal of ["load.sh", "control-center", "Control Center", ".agents/skills", "/home/", "claude-bridge"]) expect(kit).not.toContain(personal);
});

test("an agent outside Lineclear gets no kit", async () => {
  const sections: Record<string, string> = {};
  await fire("before_agent_start", { systemPromptOptions: { sections } }, { HOME: root });
  expect(sections).toEqual({});
  expect(await fire("resources_discover", {}, { HOME: root })).toEqual([undefined]);
  expect(lineclearAgent({ LINECLEAR_TASK: "LIN-1" })).toBe(true);
});

test("an installed playwright-cli brings its own skill", () => {
  const pkg = join(root, "lib", "@playwright", "cli");
  mkdirSync(join(pkg, "skills", "playwright-cli"), { recursive: true });
  writeFileSync(join(pkg, "playwright-cli.js"), "");
  chmodSync(join(pkg, "playwright-cli.js"), 0o755);
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  Bun.spawnSync(["ln", "-sf", join(pkg, "playwright-cli.js"), join(bin, "playwright-cli")]);
  expect(kitSkills({ PATH: `${bin}:/usr/bin` })).toEqual([join(import.meta.dir, "..", "kit", "skills"), join(pkg, "skills")]);
});
