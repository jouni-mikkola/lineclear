import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Stand-ins for `lineclear` and `shepherdr` on the model's path. They write each call to a log and answer with fixed
// text, so the eval sees what the model calls and nothing else happens. The four projects are the ones in cases.ts.

// `lineclear` runs fake-cli.ts, which reads names with the real resolvers, so a loose name is read the way the real command reads it.
const lineclear = `#!/bin/sh
exec bun "${join(import.meta.dir, "fake-cli.ts")}" "$@"
`;

const shepherdr = `#!/bin/sh
printf 'shepherdr\\001' >> "$EVAL_LOG"
for a in "$@"; do printf '%s\\001' "$a" >> "$EVAL_LOG"; done
printf '\\002' >> "$EVAL_LOG"
echo "asked"
exit 0
`;

/** Makes the folder with the two stand-ins, and returns it. */
export function fakeBin(dir: string): string {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  for (const [name, text] of [
    ["lineclear", lineclear],
    ["shepherdr", shepherdr],
  ] as const) {
    writeFileSync(join(bin, name), text);
    chmodSync(join(bin, name), 0o755);
  }
  return bin;
}
