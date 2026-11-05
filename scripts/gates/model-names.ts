// A model name in code: a rule or a sample tuned to one company's model. Models are settings and the model file
// (L199) holds what is known of them; code works with whatever id the file or the CLI gives. Test fixtures and docs are
// not looked at.
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
const CODE = /\.(ts|tsx|mts|js|mjs|css|json)$/;
const SCOPE = /^(src|server|ui)\//;
const FIXTURE = /(^|\/)test\/|\.test\.[a-z]+$/;

function findModelNameFaults(file: string, source: string): Fault[] {
  const faults: Fault[] = [];
  source.split("\n").forEach((line, i) => {
    const hit = MODEL_NAME.exec(line);
    if (hit) faults.push({ key: `${file} model-name`, text: `${file}:${i + 1} a model name in code (${hit[0]}): ${line.trim().slice(0, 100)}` });
  });
  return faults;
}

export const modelNames: Gate = {
  name: "model-names",
  async find(root) {
    return trackedFiles(root, CODE)
      .filter((f) => SCOPE.test(f) && !FIXTURE.test(f))
      .flatMap((file) => findModelNameFaults(file, readFileSync(join(root, file), "utf8")));
  },
};
