// The gates of the check that take seconds and run no test: a branch that fails one is red in the merge lane whatever its
// tests do. The check (scripts/check.ts) runs them as steps; `bun scripts/fast-gates.ts` runs them alone, which is what
// the board does when an agent reports a task ready, so the agent hears the message before the task joins the merge lane.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Gate {
  name: string;
  cmd: string[];
}

/** `ownFolders` are the env settings that keep bin/lineclear off the stable config, data folders and ports (src/paths.ts). */
export function fastGates(ownFolders: string[], code: boolean): Gate[] {
  return [
    { name: "roadmap", cmd: ["env", ...ownFolders, "bin/lineclear", "roadmap", "check", "."] },
    ...(code ? [{ name: "gates", cmd: ["bun", "run", "gates"] }] : []),
  ];
}

/** The first non-empty line of a failed step's output: what a log line and a refusal name it by. */
export const firstLine = (output: string): string => (output.split("\n").find((l) => l.trim() !== "") ?? "no output").trim().slice(0, 200);

if (import.meta.main) {
  const scratch = mkdtempSync(join(tmpdir(), "lc-fast-gates-"));
  const own = [`LINECLEAR_CONFIG=${join(scratch, "cfg")}`, `LINECLEAR_HOME=${join(scratch, "home")}`, "LINECLEAR_PORT=0", "LINECLEAR_WEB_PORT=0"];
  const runs = await Promise.all(
    fastGates(own, true).map(async (g) => {
      const p = Bun.spawn(g.cmd, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      return { name: g.name, ok: (await p.exited) === 0, output: `${out}${err}`.trim() };
    }),
  );
  rmSync(scratch, { recursive: true, force: true });
  const bad = runs.filter((r) => !r.ok);
  for (const r of bad) console.error(`${r.name} failed:\n${r.output.slice(-1500)}`);
  process.exit(bad.length > 0 ? 1 : 0);
}
