import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The stand-in for `lineclear` on the model's path. It writes each call to a log and answers with fixed
// text, so the eval sees what the model calls and nothing else happens. The four projects are the ones in cases.ts.

// `lineclear` runs fake-cli.ts, which reads names with the real resolvers, so a loose name is read the way the real command reads it.
const lineclear = `#!/bin/sh
exec bun "${join(import.meta.dir, "fake-cli.ts")}" "$@"
`;

/** Makes the folder with the stand-in, and returns it. */
export function fakeBin(dir: string): string {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "lineclear"), lineclear);
  chmodSync(join(bin, "lineclear"), 0o755);
  return bin;
}
