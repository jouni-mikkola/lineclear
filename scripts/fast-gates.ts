// The gates of the check that take seconds and run no test: a branch that fails one is red in the merge lane whatever its tests do.
// The check (scripts/check.ts) runs them as steps; `bun scripts/fast-gates.ts` runs them alone when an agent reports a task ready.
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

if (import.meta.main) {
  const scratch = mkdtempSync(join(tmpdir(), "lc-fast-gates-"));
  const own = [`LINECLEAR_CONFIG=${join(scratch, "cfg")}`, `LINECLEAR_HOME=${join(scratch, "home")}`, "LINECLEAR_PORT=0", "LINECLEAR_WEB_PORT=0"];
  const runs = await Promise.all(
    fastGates(own, true).map(async ({ name, cmd }) => {
      const p = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      return { name, ok: (await p.exited) === 0, output: `${out}${err}`.trim() };
    }),
  );
  rmSync(scratch, { recursive: true, force: true });
  const bad = runs.filter((r) => !r.ok);
  for (const r of bad) console.error(`${r.name} failed:\n${r.output.slice(-1500)}`);
  process.exit(bad.length > 0 ? 1 : 0);
}
