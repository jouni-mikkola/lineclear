// The contract of install: the parts that read secrets and releases rely on these reads.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
