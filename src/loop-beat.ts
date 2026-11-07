import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { dataDir } from "./paths.ts";

/** The build a process runs from, with links resolved: the same folder whichever link reached it. */
export const buildRoot = (): string => realpathSync(join(import.meta.dir, ".."));

/** The rule loop's last tick: when it ended, its process and the build it runs. */
interface LoopBeat {
  at: number;
  pid: number;
  build: string;
}

const beatPath = (env: NodeJS.ProcessEnv) => join(dataDir(env), "loop.json");

/** Written after each tick of the loop, so an update can tell that its loop ticks and not only that its server answers. */
export function writeLoopBeat(at: number, env: NodeJS.ProcessEnv = process.env): void {
  mkdirSync(dataDir(env), { recursive: true });
  writeAtomic(beatPath(env), `${JSON.stringify({ at, pid: process.pid, build: buildRoot() } satisfies LoopBeat)}\n`);
}

export function readLoopBeat(env: NodeJS.ProcessEnv = process.env): LoopBeat | undefined {
  try {
    const b = JSON.parse(readFileSync(beatPath(env), "utf8"));
    return typeof b.at === "number" && typeof b.build === "string" ? b : undefined;
  } catch {
    return undefined;
  }
}
