import { existsSync, statfsSync } from "node:fs";
import { dirname } from "node:path";

type Env = Record<string, string | undefined>;

export interface Trouble {
  name: string;
  problem: string;
  fix: string;
}

const MB = 1024 * 1024;

/** Free bytes on the disk that holds `dir`. */
export function freeBytes(dir: string): number {
  const s = statfsSync(dir);
  return s.bavail * s.bsize;
}

/** The disk of Lineclear's state is nearly full: every write would fail soon. Empty when it is fine. */
export function diskTrouble(dirs: string[], minFreeMb: string | undefined, free: (dir: string) => number = freeBytes): Trouble | undefined {
  const least = Number(minFreeMb ?? 200);
  for (const dir of dirs) {
    let left: number;
    try {
      left = free(existsSync(dir) ? dir : dirname(dir)); // before the first run the folder is not there yet
    } catch {
      continue;
    }
    if (left < least * MB) {
      return {
        name: "disk full",
        problem: `only ${Math.floor(left / MB)} MB is free where Lineclear keeps its state (${dir})`,
        fix: `Free some space, for example: du -xh --max-depth=2 ~ | sort -h | tail. Lineclear goes on by itself once ${least} MB is free.`,
      };
    }
  }
  return undefined;
}

/** The addresses that say the network is up: any one that answers is enough. */
const _hosts = (env: Env) =>
  (env.LINECLEAR_NET_CHECK ?? "github.com:443,1.1.1.1:443")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

async function _reaches(target: string, ms: number): Promise<boolean> {
  const i = target.lastIndexOf(":");
  const hostname = target.slice(0, i);
  const port = Number(target.slice(i + 1));
  try {
    const socket = await Promise.race([
      Bun.connect({ hostname, port, socket: { data() {}, error() {} } }),
      new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), ms)),
    ]);
    socket.end();
    return true;
  } catch {
    return false;
  }
}
