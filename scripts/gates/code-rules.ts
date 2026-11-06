// Two rules on the source text, one gate so each file is read once.
// A model name in code: a rule or a sample tuned to one company's model. Models are settings and the model file
// holds what is known of them; code works with whatever id the file or the CLI gives. Test fixtures and docs are
// not looked at.
// A call to herdr outside the adapter: a `herdr` command or one of herdr's sockets named anywhere but the three files of
// the adapter. Every call goes through `src/herdr.ts` (the command line) or `server/server/live/herdr.ts` and `herdr-forward.ts` (the socket
// API), so an update of herdr or a call on another machine changes one place and the contract test sees every call.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fault, Gate } from "./ratchet.ts";
import { trackedFiles } from "./tools.ts";

// a family name with a version or a variant, as an id (`family-5-5`) or as people say it (`Family 5.5`)
const MODEL_NAME = new RegExp(
  [
    "\\bclaude-(?:opus|sonnet|haiku|fable|\\d)",
    "\\bclaude-\\$\\{",
    "\\b(?:opus|sonnet|haiku|fable)[- ]\\d",
    "\\bgpt[- ]?[\\da-z]",
    "\\bgemini[- ]?[\\da-z]",
    "\\bo[134]-[a-z]",
    "\\b(?:kimi|glm)[- ]?[\\dk]",
    "\\b(?:llama|qwen)-?\\d",
    "\\b(?:mistral|grok|deepseek)-",
    "\\bcodex-(?:mini|\\d)",
  ].join("|"),
  "i",
);
const MODEL_CODE = /\.(ts|tsx|mts|js|mjs|css|json)$/;
const MODEL_SCOPE = /^(src|server|ui)\//;

const ADAPTER = new Set(["src/herdr.ts", "server/server/live/herdr.ts", "server/server/live/herdr-forward.ts"]);
const HERDR_CODE = /\.(ts|tsx|mts|js|mjs)$/;
const HERDR_SCOPE = /^(src|server)\//;
const FIXTURE = /(^|\/)test\/|\.test\.[a-z]+$/;

// a command array or a spawn or exec starting with herdr, herdr's socket file or variable, or its bridge
const HERDR_CALL = new RegExp(
  ["\\[\\s*[\"'`]herdr[\"'`]", "(?:spawn|exec)[A-Za-z]*\\(\\s*[\"'`]herdr\\b", "herdr\\.sock", "HERDR_SOCKET(?!_ENV)", "remote-api-bridge"].join("|"),
);

function findFaults(file: string, source: string): Fault[] {
  const faults: Fault[] = [];
  const modelFile = MODEL_CODE.test(file) && MODEL_SCOPE.test(file) && !FIXTURE.test(file);
  const herdrFile = HERDR_CODE.test(file) && HERDR_SCOPE.test(file) && !FIXTURE.test(file) && !ADAPTER.has(file);
  source.split("\n").forEach((line, i) => {
    const model = modelFile ? MODEL_NAME.exec(line) : null;
    if (model) faults.push({ key: `${file} model-name`, text: `${file}:${i + 1} a model name in code (${model[0]}): ${line.trim().slice(0, 100)}` });
    const herdr = herdrFile && !/^\s*(\/\/|\*|\/\*)/.test(line) ? HERDR_CALL.exec(line) : null;
    if (herdr)
      faults.push({
        key: `${file} herdr-call`,
        text: `${file}:${i + 1} a herdr call outside the adapter (${herdr[0]}): build it in src/herdr.ts or server/server/live/herdr.ts`,
      });
  });
  return faults;
}

export const codeRules: Gate = {
  name: "code-rules",
  async find(root) {
    return trackedFiles(root, MODEL_CODE)
      .filter((f) => (MODEL_SCOPE.test(f) || HERDR_SCOPE.test(f)) && !FIXTURE.test(f))
      .flatMap((file) => findFaults(file, readFileSync(join(root, file), "utf8")));
  },
};
