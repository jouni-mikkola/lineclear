// Runs commands at once from code that runs one step after another: one child bun starts them all and waits for each,
// so the caller waits once for the slowest instead of for the sum of them.

/** A command to run: its stdin travels through a pipe, never a file or an argument. */
export interface Cmd {
  argv: string[];
  stdin?: string;
  timeoutMs: number;
}

export interface Ran {
  code: number;
  out: string;
  err: string;
}

const CHILD = `
const cmds = JSON.parse(await Bun.stdin.text());
const one = async (c) => {
  try {
    const p = Bun.spawn(c.argv, { stdin: c.stdin === undefined ? "ignore" : new TextEncoder().encode(c.stdin), stdout: "pipe", stderr: "pipe", timeout: c.timeoutMs });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code: code ?? 1, out, err };
  } catch (e) {
    return { code: 127, out: "", err: String(e) };
  }
};
process.stdout.write(JSON.stringify(await Promise.all(cmds.map(one))));
`;

/** Runs every command at once and returns when all have ended: one result per command, in order. */
export function runAll(cmds: Cmd[], env: Record<string, string | undefined>): Ran[] {
  if (cmds.length === 0) return [];
  const failed = (err: string) => cmds.map(() => ({ code: 1, out: "", err }));
  try {
    const p = Bun.spawnSync([process.execPath, "-e", CHILD], {
      stdin: Buffer.from(JSON.stringify(cmds)),
      env: env as Record<string, string>,
      timeout: Math.max(...cmds.map((c) => c.timeoutMs)) + 30_000,
    });
    if (p.exitCode !== 0) return failed(p.stderr.toString().trim() || `exit ${p.exitCode}`);
    return JSON.parse(p.stdout.toString()) as Ran[];
  } catch (e) {
    return failed(String(e));
  }
}
