// Pi session files to read, for the spend test and scripts/measure-speed.ts: 20 assistant lines a file, spread over
// 20 session folders and the last 10 hours before `now`, provider a or b in turn.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const sessionLine = (at: number, n: number) =>
  JSON.stringify({
    timestamp: new Date(at).toISOString(),
    message: { role: "assistant", model: "m", provider: n % 2 ? "a" : "b", usage: { input: n, output: 1, cacheRead: 0, cacheWrite: 0 } },
  });

export function writeSessions(pi: string, now: number, files: number): void {
  for (let i = 0; i < files; i++) {
    const dir = join(pi, "sessions", `--f${i % 20}--`);
    mkdirSync(dir, { recursive: true });
    const lines = Array.from({ length: 20 }, (_, j) => sessionLine(now - ((i + j) % 10) * 3_600_000, i + j));
    writeFileSync(join(dir, `s${i}.jsonl`), `${lines.join("\n")}\n`);
  }
}
