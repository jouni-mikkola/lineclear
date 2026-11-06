import { OLD_NAME } from "../src/old-install.ts";
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Nothing of Lineclear depends on herdr-projects 2.0's folder or its port. Only migrate (and the file it reads the folder's
// name from) names them, so retiring the old folder cuts nothing off.

const root = join(import.meta.dir, "..");
const ALLOWED = new Set(["src/migrate.ts", "src/old-install.ts", "src/old-paths.ts"]);
const PLACES = ["src", "bin", "pi", "scripts", "install.sh", "server/server", "server/scripts", "server/bin", "server/helper", "server/docs"];
// the old folder as a path (not the window api or a dark class), and the old port
const OLD = new RegExp(String.raw`(?<![\w$])\.${OLD_NAME}(?![\w-])|\b7787\b`);

function files(path: string): string[] {
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(join(root, path));
  } catch {
    return [];
  }
  if (!st.isDirectory()) return [path];
  return readdirSync(join(root, path)).flatMap((n) => (n === "node_modules" || n === "dist" || n.startsWith(".") ? [] : files(join(path, n))));
}

test("no code outside migrate names the old old folder or port 7787", () => {
  const found: string[] = [];
  for (const f of PLACES.flatMap(files)) {
    if (ALLOWED.has(f)) continue;
    let text: string;
    try {
      text = readFileSync(join(root, f), "utf8");
    } catch {
      continue;
    }
    text.split("\n").forEach((line, i) => {
      if (OLD.test(line)) found.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  expect(found).toEqual([]);
});
