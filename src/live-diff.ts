// What changed between two JSON answers, as small operations, and the same operations applied. The server sends them
// and the pages apply them, so a change of one task is a few bytes and no page reads its whole answer again.

type Path = (string | number)[];

/** `v` sets the value at `p`, `d` deletes it, `a` appends to the array at `p`. */
export type Op = { p: Path; v?: unknown; d?: true; a?: unknown[] };

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const size = (x: unknown) => JSON.stringify(x).length;
// beyond this many operations a node is checked against sending itself whole
const CHECK_FROM = 12;

function walk(a: unknown, b: unknown, p: Path, ops: Op[]): void {
  if (a === b) return;
  const mine: Op[] = [];
  if (isObject(a) && isObject(b)) {
    for (const k of Object.keys(a)) if (!(k in b)) mine.push({ p: [...p, k], d: true });
    for (const [k, v] of Object.entries(b)) {
      if (k in a) walk(a[k], v, [...p, k], mine);
      else mine.push({ p: [...p, k], v });
    }
  } else if (Array.isArray(a) && Array.isArray(b) && b.length >= a.length) {
    for (let i = 0; i < a.length; i++) walk(a[i], b[i], [...p, i], mine);
    if (b.length > a.length) mine.push({ p, a: b.slice(a.length) });
  } else {
    if (JSON.stringify(a) !== JSON.stringify(b)) ops.push({ p, v: b });
    return;
  }
  ops.push(...(mine.length > CHECK_FROM && size(mine) > size(b) ? [{ p, v: b }] : mine));
}

/** The operations that turn `a` into `b`: none when they are equal. */
export function diff(a: unknown, b: unknown): Op[] {
  const ops: Op[] = [];
  walk(a, b, [], ops);
  return ops;
}

function put(root: unknown, p: Path, at: number, change: (old: unknown) => unknown | typeof GONE): unknown {
  if (at === p.length) return change(root);
  const key = p[at] as string | number;
  const child = (root as Record<string | number, unknown>)[key];
  const next = put(child, p, at + 1, change);
  if (Array.isArray(root)) {
    const copy = [...root];
    copy[key as number] = next;
    return copy;
  }
  const { [key]: _, ...rest } = root as Record<string, unknown>;
  return next === GONE ? rest : { ...rest, [key]: next };
}

const GONE = Symbol("gone");

/** `value` with the operations applied, sharing everything they leave alone. */
export function apply(value: unknown, ops: Op[]): unknown {
  let out = value;
  for (const op of ops) {
    out = put(out, op.p, 0, (old) => (op.d ? GONE : op.a ? [...(old as unknown[]), ...op.a] : op.v));
  }
  return out;
}
