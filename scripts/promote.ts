// Promotes a commit to stable: `bun scripts/promote.ts <commit>` installs it only when its GitHub `check` run on main
// is green, and prints the commit. A red, pending or missing run refuses with exit 1 and installs nothing.
// LINECLEAR_INSTALL names another installer (a test's), LINECLEAR_REPO another repository.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

type Run = { status: string; conclusion: string };

/** "green", "red" or "pending" for the newest `check` run of a commit on main; no run yet is pending. */
function verdict(commit: string, cwd = process.cwd()): "green" | "red" | "pending" {
  const r = spawnSync("gh", ["run", "list", "--workflow", "check.yml", "--branch", "main", "--commit", commit, "--limit", "1", "--json", "status,conclusion"], {
    encoding: "utf8",
    cwd,
  });
  if (r.status !== 0) return "pending";
  let runs: Run[];
  try {
    runs = JSON.parse(r.stdout) as Run[];
  } catch {
    return "pending";
  }
  const run = runs[0];
  if (run?.status !== "completed") return "pending";
  return run.conclusion === "success" ? "green" : "red";
}

function main(commit: string | undefined): number {
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) {
    console.error("usage: bun scripts/promote.ts <full commit id>");
    return 2;
  }
  const state = verdict(commit);
  if (state !== "green") {
    console.error(`promote: refused ${commit}: its check on main is ${state}`);
    return 1;
  }
  const installer = process.env.LINECLEAR_INSTALL ?? join(import.meta.dir, "..", "install.sh");
  const r = spawnSync("sh", [installer], { stdio: "inherit", env: { ...process.env, LINECLEAR_REF: commit } });
  if (r.status !== 0) return 1;
  console.log(commit);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv[2]));
