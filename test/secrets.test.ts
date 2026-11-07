import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { secrets, totp } from "../server/server/live/secrets.ts";
import { keepSecret, sh, tmp } from "./helpers.ts";

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
  set("alpha", "ALPHA_TOKEN", "a-secret");
  set("alpha", "SHARED", "it's mine");
  set("beta", "BETA_TOKEN", "b-secret");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Keeps a value in the vault where a project (a space), `--machine` or `--all` reaches it. */
function set(where: string, name: string, value: string) {
  const level = where === "--all" ? "all" : where === "--machine" ? "m:box" : `p:box:${where}-space`;
  keepSecret(env, level, name, value);
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

test("import refuses a vault it cannot read and leaves it as it was", async () => {
  writeFileSync(join(root, "data", "vault.json"), "{ broken");
  const out: string[] = [];
  expect(
    await secrets(
      ["import", "alpha-space"],
      (l) => out.push(l),
      env,
      async () => "X='v'\n",
    ),
  ).toBe(1);
  expect(out.join("\n")).toContain("can't be read");
  expect(readFileSync(join(root, "data", "vault.json"), "utf8")).toBe("{ broken");
});

test("env in a task's worktree gives only that project's values, quoted for sh", async () => {
  const e = await run(["env"]);
  expect(e.out).toBe(`export ALPHA_TOKEN='a-secret'\nexport SHARED='it'\\''s mine'`);
  const shOut = sh(["sh", "-c", `${e.out.replace(/\n/g, "; ")}; printf %s "$SHARED"`]);
  expect(shOut.out).toBe("it's mine");
  const b = await run(["env"], beta);
  expect(b.out).toBe("export BETA_TOKEN='b-secret'");
});

test("env follows the chain: the space, then this machine, then Everywhere; outside a project only the last two", async () => {
  set("--all", "LEVEL", "everywhere");
  set("--all", "WIDE", "w");
  set("--machine", "LEVEL", "machine");
  set("alpha", "LEVEL", "space");
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
  set("alpha", "BANK_TOTP", key.toLowerCase().replace(/(.{4})/g, "$1 "));
  set("--all", "EIGHT_TOTP", `otpauth://totp/x?secret=${key}&digits=8`);
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
  set("alpha", "BAD_TOTP", "not!base32");
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

test("as an agent in a task: its shell has no other project's secret, its own load, check and pi -p run", () => {
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
  for (const gone of ["BETA_TOKEN", "b-secret"]) expect(r.out).not.toContain(gone);
  expect(r.out).toContain("check command runs");
  expect(r.out).toContain("pi-ran -p");
});
