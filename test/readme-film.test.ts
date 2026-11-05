import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as film from "../scripts/readme-film.ts";
import * as roles from "../scripts/readme-roles.ts";

const root = join(import.meta.dir, "..");

// The two pictures in docs/readme: the film (what Lineclear is) and the roles chart (who does what).
const pictures = [
  { file: "line.svg", script: "readme-film.ts", draw: () => film.film(), ...film, scenes: 3, min: 12, max: 15 },
  { file: "roles.svg", script: "readme-roles.ts", draw: () => roles.roles(), ...roles, scenes: 8, min: 30, max: 50 },
];

for (const p of pictures) {
  const svg = readFileSync(join(root, "docs", "readme", p.file), "utf8");

  test(`${p.file} is the one the script writes`, () => {
    // bun run media adds the version it was made from
    expect(svg.replace(/<metadata>[^<]*<\/metadata>/, ""), `${p.file} is old: run bun scripts/${p.script}`).toBe(p.draw());
  });

  test(`${p.file} runs its length, stays small and needs no script`, () => {
    expect(p.LENGTH).toBeGreaterThanOrEqual(p.min);
    expect(p.LENGTH).toBeLessThanOrEqual(p.max);
    expect(p.SCENES).toHaveLength(p.scenes);
    expect(svg.length).toBeLessThan(150 * 1024);
    expect(svg).not.toContain("<script");
    expect(svg).not.toMatch(/href="http/);
    // Motion only for those who want it: without it the picture is its still poster.
    expect(svg).toContain("@media (prefers-reduced-motion:no-preference)");
    expect(svg).not.toMatch(/timing-function:linear/);
    expect(svg).toContain("animation-timing-function:cubic-bezier");
  });
}

test("every number in the film is listed under README film in docs/numbers.md", () => {
  const numbers = readFileSync(join(root, "docs", "numbers.md"), "utf8");
  const section = numbers.slice(numbers.indexOf("## README film"), numbers.indexOf("## U20"));
  // Scene numbers are not measurements; every other figure of the film must be sourced.
  const shown = new Set([...film.film().matchAll(/<text[^>]*>([^<]*)</g)].flatMap((m) => m[1]!.match(/\$?\d+(?:\.\d+)?/g) ?? []));
  const figures = [...shown].filter((n) => n.includes(".") || Number(n) > 9);
  expect(figures.length).toBeGreaterThan(0);
  for (const n of figures) expect(section, `${n} is not in README film`).toContain(n);
});
