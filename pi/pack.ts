// The token pack: every saving is one file in pi/parts/ whose default export registers it with pi. This file finds the
// parts, reads the switches and loads the parts that are on. A part imports nothing from another part.
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configDir, readJson } from "./config.ts";

type Env = Record<string, string | undefined>;
type Pi = { on: (event: string, handler: (event: any, ctx: any) => unknown) => void; appendEntry?: (type: string, data?: unknown) => void };

/** The entry each session records, so `lineclear measure` can split its numbers by part. */
export const PACK_ENTRY = "lineclear-pack";

/** The folder of parts, beside this file, found through the link install makes (LINECLEAR_PACK_PARTS names another, for tests). */
function partsDir(env: Env = process.env): string {
  return env.LINECLEAR_PACK_PARTS || join(dirname(realpathSync(fileURLToPath(import.meta.url))), "parts");
}

/** The switches: the parts turned off, in `<config>/pack.json`. */
export function switchesFile(env: Env = process.env): string {
  return join(configDir(env), "pack.json");
}

/** The name of each part, from its file. */
function partNames(dir: string = partsDir()): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .map((f) => f.slice(0, -3))
    .sort();
}

export function turnedOff(env: Env = process.env): string[] {
  // no file, or one that cannot be read: every part stays on
  const off = readJson(switchesFile(env))?.off;
  return Array.isArray(off) ? off.filter((x): x is string => typeof x === "string") : [];
}

/** Each part with its switch. */
export function parts(env: Env = process.env): { name: string; on: boolean }[] {
  const off = new Set(turnedOff(env));
  return partNames(partsDir(env)).map((name) => ({ name, on: !off.has(name) }));
}

/** Registers every part that is on, and records which they are in the session. Returns the names that are on. */
export default async function pack(pi: Pi, env: Env = process.env): Promise<string[]> {
  const dir = partsDir(env);
  const on: string[] = [];
  for (const part of parts(env)) {
    if (!part.on) continue;
    try {
      const mod = await import(pathToFileURL(join(dir, `${part.name}.ts`)).href);
      if (typeof mod.default !== "function") continue;
      mod.default(pi);
      on.push(part.name);
    } catch {
      // a part that fails to load must not stop pi or the other parts
    }
  }
  pi.on("session_start", () => {
    pi.appendEntry?.(PACK_ENTRY, { on });
    return undefined;
  });
  return on;
}
