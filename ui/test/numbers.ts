// What the number specs of U37 share: the CLI as the source, and the changes they make under an open page.
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { cli } from "./open.ts";

type Exported = { projects: { name: string; done: number; total: number; unit: string; tasks: { state: string }[] }[]; inbox: unknown[] };
export const exported = () => JSON.parse(cli("export")) as Exported;

export const ASKED = { question: "Release 2.4 to production?", choices: ["Release", "Not yet"], task: "API-1", project: "billing-api" };

/** Marks the page, so that a reload shows as a missing mark. */
export const mark = (page: Page) => page.evaluate(() => ((window as unknown as { __same: boolean }).__same = true));
export const unloaded = (page: Page) => page.evaluate(() => (window as unknown as { __same?: boolean }).__same === true);

export const phrases = () => {
  const doc = readFileSync("docs/design.md", "utf8");
  const at = doc.indexOf("The phrases:");
  return [...doc.slice(at, doc.indexOf("\n\n", at)).matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
};
