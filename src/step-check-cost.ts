import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "../pi/config.ts";
import type { StepCheck } from "./stepcheck.ts";

/** Every answer of every planning task (`plan-checks/<task>.json`, see `src/stepcheck.ts`). */
export function allChecks(env: NodeJS.ProcessEnv = process.env): StepCheck[] {
  const dir = join(configDir(env), "plan-checks");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")).answers ?? []) as StepCheck[]);
}
