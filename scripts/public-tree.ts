// The files that go into the public repository: every tracked file but the owner's working notes (docs/public.md).
// `bun scripts/public-tree.ts <dir>` copies them into an empty folder, with docs/public-roadmap.md as
// its ROADMAP.md. It touches no git remote.
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Working notes, measurements and machine reports of the people who build Lineclear; they do not ship. */
const PRIVATE = [/^docs\/(numbers|ROADMAP|backlog|simplify|kit|asks)\.md$/, /^docs\/(audit|research|u\d+)\//];

export const isPublic = (file: string) => file !== "docs/public-roadmap.md" && !PRIVATE.some((p) => p.test(file));

/** The tracked files that ship, as the repository holds them. */
export function publicFiles(root: string): string[] {
  const listed = Bun.spawnSync(["git", "-C", root, "ls-files", "-z"]);
  if (listed.exitCode !== 0) throw new Error("not a git repository");
  return listed.stdout.toString().split("\0").filter(Boolean).filter(isPublic);
}

function exportTree(root: string, dest: string) {
  if (readdirSync(dest, { withFileTypes: true }).length > 0) throw new Error(`${dest} is not empty`);
  const files = publicFiles(root);
  for (const file of files) {
    const to = join(dest, file);
    mkdirSync(dirname(to), { recursive: true });
    const from = join(root, file);
    if (lstatSync(from).isSymbolicLink()) symlinkSync(readlinkSync(from), to);
    else copyFileSync(from, to);
  }
  writeFileSync(join(dest, "docs", "ROADMAP.md"), readFileSync(join(root, "docs", "public-roadmap.md")));
}

if (import.meta.main) {
  const dest = process.argv[2];
  if (!dest) {
    console.error("usage: bun scripts/public-tree.ts <empty folder>");
    process.exit(2);
  }
  mkdirSync(dest, { recursive: true });
  exportTree(process.cwd(), dest);
  console.log(`public tree written to ${dest}`);
}
