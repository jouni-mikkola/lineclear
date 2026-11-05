import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_NAMES, roleSvg } from "../ui/brand/roles.ts";

test("each role's icon file matches the shapes the web pages draw", () => {
  for (const role of ROLE_NAMES) {
    const file = readFileSync(join(import.meta.dir, "..", "ui", "brand", "roles", `${role}.svg`), "utf8");
    expect(file, `${role}.svg is old: run bun scripts/role-icons.ts`).toBe(roleSvg(role));
  }
});
