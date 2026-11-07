import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { borders } from "../scripts/gates/borders.ts";
import { tmp } from "./helpers.ts";

function repo(files: Record<string, string>): string {
  const root = tmp("borders");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  Bun.spawnSync(["git", "-C", root, "init", "-q"]);
  Bun.spawnSync(["git", "-C", root, "add", "-A"]);
  return root;
}

const readme = (owns: string, mayImport: string, lines = 50) => `Owns: ${owns}\nMay import: ${mayImport}\nLines: ${lines}\n`;

test("a folder with a README is a module, and a forbidden import fails with no architecture.md", async () => {
  const root = repo({
    "low/README.md": readme("the low part", "none"),
    "low/low.ts": "export const low = 1;\n",
    "high/README.md": readme("the high part", "`low`"),
    "high/high.ts": 'import { low } from "../low/low.ts";\nexport const high = low;\n',
  });
  expect(await borders(root)).toEqual([]);

  const bad = repo({
    "low/README.md": readme("the low part", "none"),
    "low/low.ts": 'import { high } from "../high/high.ts";\nexport const low = high;\n',
    "high/README.md": readme("the high part", "`low`"),
    "high/high.ts": "export const high = 1;\n",
  });
  expect(await borders(bad)).toEqual(["low/low.ts:1 imports high/high.ts: low may not import high (low/README.md)"]);
});

test("a source file in a folder with no README, an unknown import name and a busted line budget fail", async () => {
  const root = repo({
    "loose/loose.ts": "export const a = 1;\n",
    "big/README.md": readme("the big part", "`ghost`", 1),
    "big/big.ts": "export const a = 1;\nexport const b = 2;\n",
  });
  const faults = await borders(root);
  expect(faults.some((f) => f.startsWith("loose/loose.ts is in no module"))).toBe(true);
  expect(faults).toContain("big/README.md: big may import ghost, which is no module");
  expect(faults).toContain("big has 3 lines, over the 1 that big/README.md allows");
});

test("a README can name a module and the files it covers, and a missing key fails", async () => {
  const root = repo({
    "src/README.md": `Module: \`app\`\n${readme("the app", "`part`")}\nModule: \`part\`\nCovers: \`src/part.ts\`\n${readme("one part", "none")}`,
    "src/app.ts": 'import { part } from "./part.ts";\nexport const app = part;\n',
    "src/part.ts": "export const part = 1;\n",
    "odd/README.md": "Owns: nothing else\n",
  });
  expect(await borders(root)).toEqual(["odd/README.md lacks May import, Lines in its first lines"]);
});
