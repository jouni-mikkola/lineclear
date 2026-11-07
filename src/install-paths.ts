import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

/** The nearest folder above a path that is a git checkout (a repo or a worktree), or null. The home folder never counts. */
function checkoutOf(path: string, home: string): string | null {
  for (let dir = dirname(path); dir !== home && dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
  }
  return null;
}

// a unit's Environment= lines copy the installer's PATH, which says nothing of what the unit runs
const absolutePaths = (text: string) => [...text.matchAll(/(?:^|[\s"'=:(])(\/[^\s"'<>;:)]+)/g)].map((m) => m[1] as string);

/** A file or folder's entries, or none when it cannot be read. */
function entries(dir: string): string[] {
  try {
    return readdirSync(dir).map((n) => join(dir, n));
  } catch {
    return [];
  }
}

/** Every file Lineclear's install writes or pi reads for it: the paths inside each, and where a link leads. */
function installedFiles(unitDir: string, piDir: string, data: string, bin: string): string[] {
  return [
    ...entries(unitDir).filter((f) => /^lineclear.*\.(service|timer)$/.test(f.slice(unitDir.length + 1))),
    ...entries(join(piDir, "extensions")).filter((f) => /^lineclear/.test(f.slice(join(piDir, "extensions").length + 1))),
    join(piDir, "settings.json"),
    ...entries(join(data, "helper", "bin")),
    bin,
  ];
}

/** One line for each installed file or pi setting that points into a git checkout, naming the file and the checkout. */
export function checkoutPointers(unitDir: string, piDir: string, data: string, bin: string, env: Record<string, string | undefined> = process.env): string[] {
  const home = env.HOME ?? "";
  const found: string[] = [];
  for (const file of installedFiles(unitDir, piDir, data, bin)) {
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(file);
    } catch {
      continue;
    }
    const targets = stat.isSymbolicLink() ? [realpathOrNull(file)] : [];
    // Scripts and units are small; a binary in the helper folder points nowhere and costs a second to decode.
    if (stat.isFile() && stat.size <= MAX_TEXT_BYTES) {
      const text = readTextOrNull(file);
      if (text !== null) {
        targets.push(...absolutePaths(text.replace(/^Environment=.*$/gm, "")));
        const fixed = fixedBuildIn(text);
        if (fixed) found.push(`${file} points at ${fixed}, not builds/current`);
      }
    }
    for (const t of targets) {
      const repo = t ? checkoutOf(t, home) : null;
      if (repo) found.push(`${file} points into ${repo}`);
    }
  }
  return [...new Set(found)];
}

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

const MAX_TEXT_BYTES = 1_000_000;

function readTextOrNull(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** A build folder named by version inside a file: it stops being the running build at the next update, builds/current moves. */
function fixedBuildIn(text: string): string | null {
  return text.match(/\/builds\/(?!current\b|previous\b)[^/\s"'<>;:)]+/)?.[0] ?? null;
}
