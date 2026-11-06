// `bun run ui:changed`: the browser specs of the views the branch changed (scripts/changed.ts), after a build. The full
// suite, `bun run ui:test`, is the heavy tier's.
import { changedSince } from "./gates/tools.ts";
import { specsFor } from "./changed.ts";

const specs = specsFor(changedSince(".", "main") ?? []);
if (specs?.length === 0) {
  console.log("ui:changed: no view changed, no spec to run");
  process.exit(0);
}
const build = Bun.spawnSync(["bun", "run", "web:build"], { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
console.log(specs ? `ui:changed: ${specs.join(" ")}` : "ui:changed: shared ui code changed, all specs run");
const run = Bun.spawnSync(["bunx", "playwright", "test", ...(specs ?? [])], { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
process.exit(run.exitCode ?? 1);
