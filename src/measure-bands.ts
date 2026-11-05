// Cost per call by context band: what a call carries (its prompt) against what it costs, from the usage of the sessions.
import type { Usage } from "./session-text.ts";

/** The upper edges of the bands, in prompt tokens; the last band has no edge. */
const EDGES = [20_000, 50_000, 80_000, 120_000, 150_000];

export interface Band {
  /** For example "50-80k" or "150k+". */
  band: string;
  calls: number;
  dollars: number;
  tokens: number;
}

const label = (i: number) => {
  const k = (n: number) => `${n / 1000}k`;
  if (i === EDGES.length) return `${k(EDGES[i - 1] as number)}+`;
  return `${i === 0 ? "0" : String((EDGES[i - 1] as number) / 1000)}-${k(EDGES[i] as number)}`;
};

export const emptyBands = (): Band[] => [...EDGES, Infinity].map((_, i) => ({ band: label(i), calls: 0, dollars: 0, tokens: 0 }));

/** Adds one priced call to the band its prompt (input, cache reads and cache writes) falls in. */
export function addCall(bands: Band[], u: Usage, dollars: number): void {
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  const i = EDGES.findIndex((edge) => prompt <= edge);
  const b = bands[i === -1 ? EDGES.length : i] as Band;
  b.calls++;
  b.dollars += dollars;
  b.tokens += prompt + u.output;
}

export function mergeBands(into: Band[], from: Band[]): void {
  from.forEach((b, i) => {
    const t = into[i] as Band;
    t.calls += b.calls;
    t.dollars += b.dollars;
    t.tokens += b.tokens;
  });
}

/** The band table as lines: calls, dollars per call and the share of all the cost; a band with no call is left out, and a table with no call says so. */
export function bandLines(bands: Band[]): string[] {
  const total = bands.reduce((a, b) => a + b.dollars, 0);
  if (total === 0 && bands.every((b) => b.calls === 0)) return ["cost per call by context band: no priced call of a merged step yet"];
  return bands
    .filter((b) => b.calls > 0)
    .map(
      (b) =>
        `cost per call, context ${b.band}: ${b.calls} calls, $${(b.dollars / b.calls).toFixed(3)} per call, ${total === 0 ? 0 : ((b.dollars / total) * 100).toFixed(1)} % of the cost`,
    );
}
