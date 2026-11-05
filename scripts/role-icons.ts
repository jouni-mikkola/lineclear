// Writes each role's icon to ui/brand/roles/<role>.svg from ui/brand/roles.ts, so the README and the web pages
// draw the same shapes. A test checks the files match.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_NAMES, roleSvg } from "../ui/brand/roles.ts";

const dir = join(import.meta.dirname, "..", "ui", "brand", "roles");
mkdirSync(dir, { recursive: true });
for (const role of ROLE_NAMES) writeFileSync(join(dir, `${role}.svg`), roleSvg(role));
console.log(`wrote ${ROLE_NAMES.length} icons to ${dir}`);
