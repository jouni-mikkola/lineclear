// The old product's name in a tracked file or in a file's path. Lineclear is the only product (L313): a name left in code,
// a brief or a skill is a way back to the old tool. Only the fork's notice and the changelog may keep it.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Fault, Gate } from "./ratchet.ts";
import { trackedFiles } from "./tools.ts";

// built in two parts so this file does not spell it
const OLD_NAME = new RegExp(["shep", "herdr"].join(""), "i");
const ALLOWED = new Set(["server/NOTICE", "CHANGELOG.md", "LICENSE", "server/LICENSE"]);
const BINARY = /\.(png|jpe?g|webp|gif|ico|woff2?|mp4|webm|pdf|zip|gz|tgz|blend)$/i;

export const oldName: Gate = {
  name: "old-name",
  async find(root) {
    const faults: Fault[] = [];
    for (const file of trackedFiles(root, /./)) {
      if (ALLOWED.has(file)) continue;
      if (OLD_NAME.test(file)) faults.push({ key: `${file} old-name`, text: `${file}: the old name in the file's path` });
      if (BINARY.test(file) || !statSync(join(root, file)).isFile()) continue;
      readFileSync(join(root, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (OLD_NAME.test(line)) faults.push({ key: `${file} old-name`, text: `${file}:${i + 1} the old name: ${line.trim().slice(0, 100)}` });
        });
    }
    return faults;
  },
};
