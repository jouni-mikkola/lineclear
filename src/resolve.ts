import { basename } from "node:path";
import { listProjectNames, readSettings } from "./project.ts";

/** A name or title without case, accents, Finnish ä and ö, spaces or punctuation: "Oma-Labra" and "webshop" match. */
export const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]!;
}

/** The two candidates nearest to `input` by spelling, nearest first. */
export function nearest(input: string, names: string[]): string[] {
  const f = fold(input);
  return names
    .map((n) => ({ n, d: distance(f, fold(n)) - (fold(n).startsWith(f.slice(0, 3)) ? 0.5 : 0) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 2)
    .map((x) => x.n);
}

/** `no <what> '<input>'`, with the two nearest candidates when there are any. */
const refusal = (what: string, input: string, names: string[]) => {
  const near = nearest(input, names);
  return `no ${what} '${input}'${near.length > 0 ? `, nearest: ${near.map((n) => `'${n}'`).join(" and ")}` : ""}`;
};

/**
 * Finds the one candidate that a loosely written `input` means, or says why not. A candidate is a list of the spellings
 * it goes by, the first being its name. It matches the exact spelling, then the folded one, then a Finnish ending on a
 * name ("webshopan") a start of a name of at least 4 characters ("omal") or a typo of 2 letters, when exactly one candidate fits.
 */
export function resolveOne(what: string, input: string, candidates: string[][]): { name: string; loose: boolean } | { error: string } {
  const names = candidates.map((c) => c[0]!);
  const exact = candidates.find((c) => c[0] === input);
  if (exact) return { name: exact[0]!, loose: false };
  const f = fold(input);
  if (f === "") return { error: refusal(what, input, names) };
  const tiers: ((spelling: string) => boolean)[] = [
    (s) => fold(s) === f,
    (s) => fold(s).length >= 4 && f.startsWith(fold(s)) && f.length - fold(s).length <= 4,
    (s) => f.length >= 4 && fold(s).startsWith(f),
  ];
  // a small typo in a name of 5 characters or more, when exactly one candidate is that near
  const typo = (s: string) => fold(s).length >= 5 && distance(f, fold(s)) <= 2;
  tiers.push(typo);
  for (const fits of tiers) {
    const hits = candidates.filter((c) => c.some(fits));
    if (hits.length === 1) return { name: hits[0]![0]!, loose: true };
    if (hits.length > 1)
      return {
        error: `'${input}' fits more than one ${what}: ${hits
          .slice(0, 2)
          .map((h) => `'${h[0]}'`)
          .join(" and ")}, use the exact one`,
      };
  }
  return { error: refusal(what, input, names) };
}

/** One project from a loose name: its case, its repo's folder name or a Finnish ending. */
export function resolveProject(input: string, env = process.env): { name: string; loose: boolean } | { error: string } {
  const names = listProjectNames(env);
  if (names.length === 0) return { error: "no projects, add one with 'lineclear project add <repo>'" };
  const candidates = names.map((n) => {
    const s = readSettings(n, env);
    return typeof s === "string" ? [n] : [n, basename(s.repo)];
  });
  return resolveOne("project", input, candidates);
}

/** One step from a loose id or title, among the steps `steps` of a roadmap. */
export function resolveStep(input: string, steps: { id: string; title: string }[]): { name: string; loose: boolean } | { error: string } {
  const exact = steps.find((s) => s.id === input);
  if (exact) return { name: exact.id, loose: false };
  const byId = steps.filter((s) => s.id.toLowerCase() === input.trim().toLowerCase());
  if (byId.length === 1) return { name: byId[0]!.id, loose: true };
  const f = fold(input);
  const byTitle = f.length >= 3 ? steps.filter((s) => fold(s.title) === f || fold(s.title).includes(f)) : [];
  const same = byTitle.filter((s) => fold(s.title) === f);
  const pick = same.length === 1 ? same : byTitle;
  if (pick.length === 1) return { name: pick[0]!.id, loose: true };
  const labels = steps.map((s) => `${s.id} ${s.title}`);
  if (pick.length > 1)
    return {
      error: `'${input}' fits more than one step: ${pick
        .slice(0, 2)
        .map((s) => `'${s.id} ${s.title}'`)
        .join(" and ")}, use the id`,
    };
  const near = nearest(
    input,
    steps.map((s) => s.id),
  ).concat(
    nearest(
      input,
      steps.map((s) => s.title),
    ).map((t) => steps.find((s) => s.title === t)!.id),
  );
  const two = [...new Set(near)].slice(0, 2).map((id) => `'${labels[steps.findIndex((s) => s.id === id)]}'`);
  return { error: `no step '${input}', nearest: ${two.join(" and ")}` };
}

/** " (read 'x' as y)" for each pair whose input was not written as the name, or nothing. */
export const looseNote = (pairs: [string, string][]) => {
  const loose = pairs.filter(([input, name]) => input !== name);
  return loose.length === 0 ? "" : ` (read ${loose.map(([i, n]) => `'${i}' as ${n}`).join(", ")})`;
};
