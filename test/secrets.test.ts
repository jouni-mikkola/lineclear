import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import lineclearExtension, { pathRefusal, refusal } from "../pi/extension.ts";
import { secrets, totp } from "../src/secrets.ts";
import { sh, tmp } from "./helpers.ts";

let root: string;
let env: Record<string, string | undefined>;
let alpha: string;
let beta: string;
let alphaTask: string;

const git = (cwd: string, ...a: string[]) => sh(["git", "-c", "user.email=a@b.c", "-c", "user.name=t", ...a], { cwd });

beforeEach(async () => {
  root = tmp("secrets");
  env = {
    ...process.env,
    LINECLEAR_CONFIG: join(root, "config"),
    LINECLEAR_MAIN_HOME: join(root, "data"),
    LINECLEAR_MACHINE: "box",
    LINECLEAR_PORT: "0",
    LINECLEAR_WEB_PORT: "0",
    HOME: root,
    LINECLEAR_BIN: join(import.meta.dir, "..", "bin", "lineclear"),
  };
  alpha = join(root, "alpha");
  beta = join(root, "beta");
  for (const r of [alpha, beta]) {
    mkdirSync(r);
    git(r, "init", "-q", "-b", "main");
    git(r, "commit", "-q", "--allow-empty", "-m", "x");
    const name = r === alpha ? "alpha" : "beta";
    mkdirSync(join(root, "config", "projects", name), { recursive: true });
    writeFileSync(
      join(root, "config", "projects", name, "settings.json"),
      JSON.stringify({ repo: r, space: `${name}-space`, check: "true", models: { worker: ["a"], reviewer: ["b"], planner: ["c"] } }),
    );
  }
  alphaTask = join(root, "alpha-task");
  git(alpha, "worktree", "add", "-q", "-b", "task", alphaTask);
  await set("alpha", "ALPHA_TOKEN", "a-secret");
  await set("alpha", "SHARED", "it's mine");
  await set("beta", "BETA_TOKEN", "b-secret");
  writeFileSync(join(root, "config", "owner.env"), "OWNER_LOGIN='o-secret'\nSHARED='x'\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function set(where: string, name: string, value: string) {
  const out: string[] = [];
  const code = await secrets(
    ["set", where, name],
    (l) => out.push(l),
    env,
    async () => `${value}\n`,
  );
  expect(code).toBe(0);
}

async function run(args: string[], cwd = alphaTask) {
  const out: string[] = [];
  const code = await secrets(
    args,
    (l) => out.push(l),
    env,
    async () => "",
    cwd,
  );
  return { code, out: out.join("\n") };
}

const vault = () => JSON.parse(readFileSync(join(root, "data", "vault.json"), "utf8"));

test("set keeps the value in the server's vault, mode 600, at the project's space, and list prints names only", async () => {
  expect(statSync(join(root, "data", "vault.json")).mode & 0o777).toBe(0o600);
  expect(vault()["p:box:alpha-space"].ALPHA_TOKEN.value).toBe("a-secret");
  expect(vault()["p:box:beta-space"].BETA_TOKEN.value).toBe("b-secret");
  const l = await run(["list", "alpha"]);
  expect(l.out).toBe("ALPHA_TOKEN\nSHARED");
  expect(l.out).not.toContain("a-secret");
});

test("set refuses a bad name, an empty value and an unknown project", async () => {
  expect((await run(["set", "alpha", "1bad"])).code).toBe(1);
  expect((await run(["set", "nope", "X"])).code).toBe(1);
  expect((await run(["set", "alpha", "X"])).code).toBe(1); // empty stdin
  expect((await run(["set", "alpha"])).code).toBe(1);
});

test("set refuses a vault it cannot read and leaves it as it was", async () => {
  writeFileSync(join(root, "data", "vault.json"), "{ broken");
  const out: string[] = [];
  expect(
    await secrets(
      ["set", "--all", "X"],
      (l) => out.push(l),
      env,
      async () => "v",
    ),
  ).toBe(1);
  expect(out.join("\n")).toContain("cannot be read");
  expect(readFileSync(join(root, "data", "vault.json"), "utf8")).toBe("{ broken");
});

test("env in a task's worktree gives only that project's values, quoted for sh", async () => {
  const e = await run(["env"]);
  expect(e.out).toBe(`export ALPHA_TOKEN='a-secret'\nexport SHARED='it'\\''s mine'`);
  const shOut = sh(["sh", "-c", `${e.out.replace(/\n/g, "; ")}; printf %s "$SHARED"`]);
  expect(shOut.out).toBe("it's mine");
  const b = await run(["env"], beta);
  expect(b.out).toBe("export BETA_TOKEN='b-secret'");
  expect(b.out).not.toContain("OWNER_LOGIN");
});

test("env follows the chain: the space, then this machine, then Everywhere; outside a project only the last two", async () => {
  await set("--all", "LEVEL", "everywhere");
  await set("--all", "WIDE", "w");
  await set("--machine", "LEVEL", "machine");
  await set("alpha", "LEVEL", "space");
  expect((await run(["env"])).out).toContain("export LEVEL='space'");
  expect((await run(["env"], beta)).out).toContain("export LEVEL='machine'");
  const outside = await run(["env"], root);
  expect(outside.code).toBe(0);
  expect(outside.out).toBe("export LEVEL='machine'\nexport WIDE='w'");
  expect(vault()["m:box"].LEVEL.value).toBe("machine");
});

test("import puts a sent env file into the vault at the space's level, and keeps no file per project", async () => {
  const out: string[] = [];
  expect(
    await secrets(
      ["import", "alpha-space"],
      (l) => out.push(l),
      env,
      async () => "SENT='s'\nALPHA_TOKEN='new'\n",
    ),
  ).toBe(0);
  const e = await run(["env"]);
  expect(e.out).toContain("export SENT='s'");
  expect(e.out).toContain("export ALPHA_TOKEN='new'");
  expect(existsSync(join(root, "config", "projects", "alpha", "secrets.env"))).toBe(false);
});

test("totp prints the RFC 6238 code of NAME_TOTP and nothing else", async () => {
  const key = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890", the RFC's SHA1 key
  await set("alpha", "BANK_TOTP", key.toLowerCase().replace(/(.{4})/g, "$1 "));
  await set("--all", "EIGHT_TOTP", `otpauth://totp/x?secret=${key}&digits=8`);
  const code = (name: string, cwd = alphaTask) => {
    const out: string[] = [];
    return { code: totp([name], (l) => out.push(l), env, cwd, 59_000), out };
  };
  expect(code("EIGHT")).toEqual({ code: 0, out: ["94287082"] });
  expect(code("bank")).toEqual({ code: 0, out: ["287082"] });
  expect(code("BANK_TOTP")).toEqual({ code: 0, out: ["287082"] });
  expect(code("BANK", beta).out.join()).toContain("BANK_TOTP is not kept"); // another space's login
});

test("totp names a missing or broken key, never its value", async () => {
  await set("alpha", "BAD_TOTP", "not!base32");
  const out: string[] = [];
  expect(totp(["BAD"], (l) => out.push(l), env, alphaTask)).toBe(1);
  expect(totp(["NONE"], (l) => out.push(l), env, alphaTask)).toBe(1);
  expect(totp([], (l) => out.push(l), env, alphaTask)).toBe(2);
  expect(out.join("\n")).toContain("BAD_TOTP is not a TOTP key");
  expect(out.join("\n")).toContain("NONE_TOTP is not kept");
  expect(out.join("\n")).not.toContain("not!base32");
});

test("the cli routes secrets", async () => {
  const out: string[] = [];
  expect(await main(["secrets"], (l) => out.push(l))).toBe(2);
});

test("an agent in alpha: owner-only and other projects' names and files are refused, own ones are not", () => {
  const r = (c: string) => refusal(c, alphaTask, env);
  expect(r("echo $OWNER_LOGIN")).toContain("OWNER_LOGIN");
  expect(r("echo $BETA_TOKEN")).toContain("BETA_TOKEN");
  expect(r("echo $ALPHA_TOKEN")).toBeUndefined();
  expect(r("echo $SHARED")).toBeUndefined(); // own name, even if owner.env has it too
  expect(r("cat ~/.config/lineclear/owner.env")).toContain("owner.env");
  expect(r(`cat ${root}/config/projects/beta/secrets.env`)).toContain("secrets.env");
  expect(r("cd ~/.config/lineclear/projects/beta && cat secrets.env")).toContain("secrets.env");
  expect(r("cat ~/.config/lineclear/owner.e*")).toContain("owner.env");
  expect(r("jq . $HOME/.lineclear/vault.json")).toContain("vault");
  expect(pathRefusal("~/.lineclear/vault.json", alphaTask, env)).toContain("vault");
  expect(r("lineclear backup restore /tmp/r")).toContain("every secret");
  expect(r("lineclear backup status")).toBeUndefined();
  expect(r("lineclear backup 'restore' /tmp/r")).toContain("every secret");
  expect(r("cat ~/.lineclear/vault*")).toContain("vault");
  expect(r("cat ~/.lineclear/va'ult'.json")).toContain("vault");
  expect(r("lineclear secrets list beta")).toContain("secrets env");
  expect(r('eval "$(lineclear secrets env)"')).toBeUndefined();
  expect(r("ls ~/.ssh")).toContain(".ssh");
  expect(r("cat ~/.git-credentials")).toContain("git");
  expect(r("cat ~/.config/gh/hosts.yml")).toContain("gh");
  expect(r("echo BETA_TOKENS_ARE_NOT_A_NAME")).toBeUndefined();
}); // each refusal asks the lineclear command, 15 processes: the check's own timeout, which scales with load, applies

test("git push is refused in each form, other git and the project's work are not", () => {
  const r = (c: string) => refusal(c, alphaTask, env);
  for (const c of ["git push", "git push origin main", "cd x && git push -f", "git -C /x push", "git -c a=b push", "git --no-pager push", "true; git push"])
    expect(r(c)).toContain("git push");
  for (const c of ["git status", "git commit -m 'push it'", "git pull", "echo git pushed", "bun run check", "pi -p 'review this'"])
    expect(r(c)).toBeUndefined();
});

test("the extension blocks through pi's tool_call event and lets a check and pi -p run", async () => {
  const handlers: ((e: any, c: any) => any)[] = [];
  await lineclearExtension({ on: (n, h) => void (n === "tool_call" && handlers.push(h)) });
  const handler = handlers[0]!; // its own handler, before the token pack's parts
  const bash = (command: string) => handler({ toolName: "bash", input: { command } }, { cwd: alphaTask });
  const old = { ...process.env };
  Object.assign(process.env, env);
  try {
    expect(bash("git push").block).toBe(true);
    expect(bash("echo $OWNER_LOGIN").reason).toContain("OWNER_LOGIN");
    expect(bash("bun run check")).toBeUndefined();
    expect(bash("pi -p 'review the diff'")).toBeUndefined();
    expect(handler({ toolName: "read", input: { path: join(root, "config", "owner.env") } }, { cwd: alphaTask }).block).toBe(true);
    expect(handler({ toolName: "read", input: { path: "src/cli.ts" } }, { cwd: alphaTask })).toBeUndefined();
  } finally {
    for (const k of Object.keys(env)) if (!(k in old)) delete process.env[k];
    Object.assign(process.env, old);
  }
  expect(existsSync(join(root, "config", "owner.env"))).toBe(true);
});

test("as an agent in a task: its shell has no owner-only or other project name, its own load, check and pi -p run", () => {
  const bin = join(import.meta.dir, "..", "bin", "lineclear");
  const stubs = join(root, "stubs");
  mkdirSync(stubs);
  writeFileSync(join(stubs, "pi"), '#!/bin/sh\necho pi-ran "$1"\n', { mode: 0o755 });
  const agent = {
    PATH: `${stubs}:${process.env.PATH}`,
    HOME: root,
    LINECLEAR_CONFIG: join(root, "config"),
    LINECLEAR_MAIN_HOME: join(root, "data"),
    LINECLEAR_MACHINE: "box",
  };
  const script = `eval "$("${bin}" secrets env)"; env; "${bin}" project check alpha; pi -p`;
  const r = sh(["sh", "-c", script], { cwd: alphaTask, env: agent });
  expect(r.out).toContain("ALPHA_TOKEN=a-secret");
  for (const gone of ["OWNER_LOGIN", "BETA_TOKEN", "o-secret", "b-secret"]) expect(r.out).not.toContain(gone);
  expect(r.out).toContain("check command runs");
  expect(r.out).toContain("pi-ran -p");
  expect(refusal(script.replace(bin, "lineclear"), alphaTask, env)).toBeUndefined();
});

test("adopt moves an old env tree into the vault: common to Everywhere, machine to this machine, a repo's file to its project, and prints no value", async () => {
  const old = join(root, "old");
  mkdirSync(join(old, "me"), { recursive: true });
  mkdirSync(join(old, "machine"));
  writeFileSync(join(old, "common.env"), "COMMON_ONE='c1'\n");
  writeFileSync(join(old, "machine", "sudo.env"), "SUDO_X='s1'\n");
  writeFileSync(join(old, "me", "alpha.env"), "# note\nALPHA_NEW='a1'\n");
  writeFileSync(join(old, "me", "gone.env"), "GONE='g'\n");
  const out: string[] = [];
  expect(await secrets(["adopt", old], (l) => out.push(l), env)).toBe(0);
  expect(out.join("\n")).not.toMatch(/c1|s1|a1/);
  expect(out.join("\n")).toContain("skipped me/gone.env");
  const e = (await run(["env"], root)).out;
  expect(e).toContain("export COMMON_ONE='c1'");
  expect(e).toContain("export SUDO_X='s1'");
  expect(e).not.toContain("ALPHA_NEW");
  expect((await run(["env"], alphaTask)).out).toContain("export ALPHA_NEW='a1'");
});
