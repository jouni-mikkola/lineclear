import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./media-lib.ts";

/** What is wrong with the release notes in docs/releases: a part off the template, a left-over {field}, a missing picture. */
export function releaseProblems(root: string = ROOT): string[] {
  const dir = join(root, "docs", "releases");
  const heads = (t: string): string[] => [...(t.match(/^## .+$/gm) ?? [])];
  const template = heads(readFileSync(join(dir, "TEMPLATE.md"), "utf8"));
  const out: string[] = [];
  for (const f of readdirSync(dir).filter((f) => /^\d+\.\d+\.\d+\.md$/.test(f))) {
    const v = f.replace(/\.md$/, "");
    const text = readFileSync(join(dir, f), "utf8");
    if (!text.startsWith(`# Lineclear ${v}\n\n![`)) out.push(`${f} does not start with the template's title and a picture`);
    if (/\{[a-z]+\}/.test(text)) out.push(`${f} leaves a template field unfilled`);
    const own = heads(text);
    if (JSON.stringify(own) !== JSON.stringify(template.filter((h) => own.includes(h))) || own.some((h) => !template.includes(h))) {
      out.push(`${f} leaves the template's parts or their order`);
    }
    const pictures = [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(([, p = ""]) => p);
    if (pictures.length === 0) out.push(`${f} shows no picture of what changed`);
    for (const p of pictures) if (!existsSync(join(dir, p))) out.push(`${f} shows ${p}, which is not there`);
  }
  return out;
}
