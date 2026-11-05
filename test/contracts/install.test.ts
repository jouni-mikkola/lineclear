// The contract of install: the parts that read machines, secrets and releases rely on these reads.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMachines } from "../../src/machine-list.ts";
import { readRelease, saveRelease } from "../../src/release.ts";
import { secretNames, secrets, storedLoginAdvice } from "../../src/secrets.ts";
import { tmp } from "../helpers.ts";

/** A temporary config folder with project `alpha` in it. */
const fresh = () => {
  const root = tmp("contract-install");
  const env = { ...process.env, LINECLEAR_CONFIG: join(root, "config"), LINECLEAR_MAIN_HOME: join(root, "data"), LINECLEAR_MACHINE: "box", HOME: root };
  mkdirSync(join(root, "config", "projects", "alpha"), { recursive: true });
  writeFileSync(
    join(root, "config", "projects", "alpha", "settings.json"),
    JSON.stringify({ repo: join(root, "alpha"), space: "alpha-space", check: "true", models: { worker: ["a"], reviewer: ["b"], planner: ["c"] } }),
  );
  return env;
};

const store = async (env: ReturnType<typeof fresh>, name: string, value: string) =>
  expect(
    await secrets(
      ["set", "alpha", name],
      () => {},
      env,
      async () => `${value}\n`,
    ),
  ).toBe(0);

const writeMachines = (env: ReturnType<typeof fresh>, text: string) => writeFileSync(join(env.LINECLEAR_CONFIG, "machines.json"), text);

test("readMachines gives [] with no file and with a file that is not JSON", () => {
  const env = fresh();
  expect(readMachines(env)).toEqual([]);
  writeMachines(env, "not json {");
  expect(readMachines(env)).toEqual([]);
});

test("readMachines drops an entry with an invalid host and fails an install whose pid is gone", () => {
  const env = fresh();
  const since = "2026-01-01T00:00:00Z";
  writeMachines(
    env,
    JSON.stringify({
      machines: [
        { host: "good.example", state: "ready", since },
        { host: "bad host; rm -rf", state: "ready", since },
        { host: "gone.example", state: "installing", since, pid: 2 ** 22 + 12345 },
      ],
    }),
  );
  const list = readMachines(env);
  expect(list.map((m) => m.host)).toEqual(["good.example", "gone.example"]);
  expect(list[0]?.state).toBe("ready");
  expect(list[1]?.state).toBe("failed");
});

test("secretNames gives a project's names sorted and never a value", async () => {
  const env = fresh();
  await store(env, "ZED_TOKEN", "value-zed-1");
  await store(env, "ALPHA_KEY", "value-alpha-2");
  await store(env, "MID_PASS", "value-mid-3");
  const names = secretNames("alpha", env);
  expect(names).toEqual(["ALPHA_KEY", "MID_PASS", "ZED_TOKEN"]);
  expect(JSON.stringify(names)).not.toContain("value-");
});

test("storedLoginAdvice names a stored login by name only, and gives undefined when the text names none", async () => {
  const env = fresh();
  await store(env, "SHOP_USER", "user-value-1");
  await store(env, "SHOP_PASSWORD", "pass-value-2");
  const advice = storedLoginAdvice("Log in to the shop", "alpha", env);
  expect(advice).toContain("SHOP_USER");
  expect(advice).toContain("SHOP_PASSWORD");
  expect(advice).not.toContain("-value-");
  expect(storedLoginAdvice("Log in to the bank", "alpha", env)).toBeUndefined();
});

test("readRelease gives {} with no state file and the saved state after saveRelease", () => {
  const env = fresh();
  expect(readRelease(env)).toEqual({});
  const state = { checked: "2026-01-01T00:00:00Z" };
  saveRelease(state, env);
  expect(readRelease(env)).toEqual(state);
});
