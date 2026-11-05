// A call to herdr outside the adapter: a `herdr` command or one of herdr's sockets named anywhere but the three files of
// the adapter. Every call goes through `src/herdr.ts` (the command line) or `server/server/live/herdr.ts` and `herdr-forward.ts` (the socket
// API), so an update of herdr or a call on another machine changes one place and the contract test sees every call.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fault, Gate } from "./ratchet.ts";
import { trackedFiles } from "./tools.ts";

const ADAPTER = new Set(["src/herdr.ts", "server/server/live/herdr.ts", "server/server/live/herdr-forward.ts"]);
const CODE = /\.(ts|tsx|mts|js|mjs)$/;
const SCOPE = /^(src|server)\//;
const TEST = /(^|\/)test\/|\.test\.[a-z]+$/;

// a command array or a spawn or exec starting with herdr, herdr's socket file or variable, or its bridge
const CALL = new RegExp(
  ["\\[\\s*[\"'`]herdr[\"'`]", "(?:spawn|exec)[A-Za-z]*\\(\\s*[\"'`]herdr\\b", "herdr\\.sock", "HERDR_SOCKET(?!_ENV)", "remote-api-bridge"].join("|"),
);

function findCalls(file: string, source: string): Fault[] {
  const faults: Fault[] = [];
  source.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const hit = CALL.exec(line);
    if (hit)
      faults.push({
        key: `${file} herdr-call`,
        text: `${file}:${i + 1} a herdr call outside the adapter (${hit[0]}): build it in src/herdr.ts or server/server/live/herdr.ts`,
      });
  });
  return faults;
}

export const herdrCalls: Gate = {
  name: "herdr-calls",
  async find(root) {
    return trackedFiles(root, CODE)
      .filter((f) => SCOPE.test(f) && !TEST.test(f) && !ADAPTER.has(f))
      .flatMap((file) => findCalls(file, readFileSync(join(root, file), "utf8")));
  },
};
