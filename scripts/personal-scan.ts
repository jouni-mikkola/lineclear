// A secret and personal-data scan of every file that ships (scripts/public-tree.ts), run locally in the check: it fails on
// a key, a token, a private-key block, a real e-mail address, a home folder of a real user, a tailnet address, or a word of
// scripts/personal-words.ts (host names, personal names, private projects), which lives in a file outside the repo. No network, no tool to install.
import { readFileSync, statSync } from "node:fs";
import { personalWords } from "./personal-words.ts";
import { publicFiles } from "./public-tree.ts";

type Rule = { name: string; re: RegExp; allow?: (match: string) => boolean };

// Fixtures and examples use these; anything else in a ship-able file is a real name.
const FAKE_MAIL = /@(?:[\w-]+\.)*(?:example\.(com|org|net)|[\w.-]*\.invalid|localhost|users\.noreply\.github\.com|noreply\.[\w.]+)$|^git@/i;
const FAKE_HOME = /^\/home\/(?:(?:user|users|me|you|name|someone|stable|a|u|x|other|runner|fixture-agent)$|[$<{.])/;

const RULES: Rule[] = [
  { name: "private key", re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/ },
  { name: "AWS key id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/ },
  { name: "API key", re: /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b/ },
  { name: "bearer or JWT", re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/ },
  {
    name: "password in a URL",
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"`]+:[^\s/:@'"`$<{]{6,}@/i,
    allow: (m) => /:\/\/[^:]+:(x-oauth-basic|password|secret|pass|token|\*+)@/i.test(m),
  },
  {
    name: "e-mail address",
    re: /[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
    allow: (m) => FAKE_MAIL.test(m) || /\.(service|timer|socket|png|webp|jpe?g|svg|json|ts|tsx|css)$/i.test(m) || /@\d(?:x|\.)|@\d+x/.test(m),
  },
  { name: "home folder of a real user", re: /(?<![\w./-])\/home\/[A-Za-z0-9._<{$-]+/g, allow: (m) => FAKE_HOME.test(m) },
  { name: "tailnet address", re: /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/, allow: (m) => m === "100.64.0.1" },
];

const words = personalWords();

/** The problems in one file's text: `file:line: what`. */
export function scanText(file: string, text: string, personal: string[] = words): string[] {
  const found: string[] = [];
  text.split("\n").forEach((line, i) => {
    const lower = line.toLowerCase();
    for (const w of personal) if (lower.includes(w)) found.push(`${file}:${i + 1}: personal word "${w}"`);
    for (const rule of RULES) {
      const re = new RegExp(rule.re.source, `${rule.re.flags.replace("g", "")}g`);
      for (const m of line.matchAll(re)) if (!rule.allow?.(m[0])) found.push(`${file}:${i + 1}: ${rule.name}`);
    }
  });
  return found;
}

if (import.meta.main) {
  const root = process.argv[2] ?? ".";
  const hits: string[] = [];
  for (const file of publicFiles(root)) {
    const path = `${root}/${file}`;
    if (!statSync(path, { throwIfNoEntry: false })?.isFile()) continue;
    const bytes = readFileSync(path);
    if (bytes.includes(0)) continue;
    hits.push(...scanText(file, bytes.toString("utf8")));
  }
  for (const h of hits) console.error(h);
  if (hits.length > 0) console.error(`personal scan: ${hits.length} hit${hits.length === 1 ? "" : "s"}; fix the file, never the scan`);
  process.exit(hits.length > 0 ? 1 : 0);
}
