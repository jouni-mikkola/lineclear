import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { readJson } from "../pi/config.ts";
import { parts, switchesFile, turnedOff } from "../pi/pack.ts";

type Env = Record<string, string | undefined>;
type Out = (line: string) => void;

export { parts };

/** Turns a part on or off. Returns an error line, or undefined when it is done. */
function setPart(name: string, on: boolean, env: Env = process.env): string | undefined {
  if (!parts(env).some((p) => p.name === name)) return `no part '${name}' in the token pack`;
  const off = new Set(turnedOff(env));
  const had = off.has(name);
  if (on) off.delete(name);
  else off.add(name);
  if (had === !on) return undefined; // already so: no write
  const file = switchesFile(env);
  mkdirSync(dirname(file), { recursive: true });
  // keep the file's other settings
  writeAtomic(file, `${JSON.stringify({ ...readJson(file), off: [...off].sort() }, null, 2)}\n`);
  return undefined;
}

/** Prints the parts and their switches, or the part's `on` or `off` after the change. */
export function packMain(args: string[], out: Out, env: Env = process.env): number {
  const [verb, name, ...extra] = args;
  if (verb === undefined || verb === "list") {
    const all = parts(env);
    if (all.length === 0) out("The token pack has no parts yet.");
    for (const p of all) out(`${p.on ? "on " : "off"}  ${p.name}`);
    return 0;
  }
  if ((verb !== "on" && verb !== "off") || name === undefined || extra.length > 0) {
    out("usage: lineclear pack [list | on <part> | off <part>]");
    return 2;
  }
  const error = setPart(name, verb === "on", env);
  if (error) return (out(`lineclear pack: ${error}`), 1);
  out(`${name}: ${verb}`);
  return 0;
}
