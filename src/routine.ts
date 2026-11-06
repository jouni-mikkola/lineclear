import { homedir } from "node:os";
import { join } from "node:path";
import { readJson } from "../pi/config.ts";
import { priceFinder } from "./measure.ts";
import { stepFiles } from "./parts.ts";
import type { Step } from "./roadmap.ts";

/** A baseline, a test or a doc: a step that touches only these changes data or proof, not behaviour. */
const ROUTINE_FILE = /^(docs\/|scripts\/gates\/baseline\/|test\/|ui\/test\/)|\.test\.[cm]?[jt]sx?$/;

/** A step is routine when it names files and every one is under `docs/`, a test or a gate baseline. */
export function isRoutine(step: Step): boolean {
  const files = stepFiles(step);
  return files.length > 0 && files.every((f) => ROUTINE_FILE.test(f));
}

/** Price per token (input plus output) of a model in pi's models store, or undefined when unpriced. */
export function modelPrice(env = process.env): (model: string) => number | undefined {
  const price = priceFinder(readJson(join(env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "models-store.json")));
  return (m) => {
    const [provider, ...rest] = m.split("/");
    const p = price({ provider: rest.length ? provider : undefined, model: rest.length ? rest.join("/") : m } as never);
    return p ? p.input + p.output : undefined;
  };
}

/** The cheapest priced, usable model of the worker list; undefined when none is priced, so a routine step then keeps the worker model. */
export function cheapWorker(
  workers: string[],
  price: (model: string) => number | undefined,
  usable: (model: string) => boolean = () => true,
): string | undefined {
  let best: { m: string; p: number } | undefined;
  for (const m of workers) {
    const p = usable(m) ? price(m) : undefined;
    if (p !== undefined && (best === undefined || p < best.p)) best = { m, p };
  }
  return best?.m;
}

/** The cheap model a routine step starts on, or undefined for any other step. */
export const routineWorker = (step: Step, workers: string[], env: NodeJS.ProcessEnv, usable: (model: string) => boolean) =>
  isRoutine(step) ? cheapWorker(workers, modelPrice(env), usable) : undefined;
