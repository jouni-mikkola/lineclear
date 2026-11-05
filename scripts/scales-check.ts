// The Scales check of the merge: the diff from main read against the "Scales" section of docs/design.md by a model. An empty model is the harness default.
import { checkDiffScales } from "../src/stepcheck.ts";

const root = process.argv[2] ?? ".";
const model = process.env.LINECLEAR_SCALES_MODEL ?? "";
const diff = Bun.spawnSync(["git", "-C", root, "diff", "main...HEAD", "--", ".", ":!docs/", ":!test/"], { stdin: "ignore" }).stdout.toString();
const result = checkDiffScales(root, diff, model, process.env);
if (result && "refused" in result) {
  console.error(`scales check: ${result.refused}`);
  process.exit(1);
}
if (result) console.warn(`scales check skipped: ${result.unavailable}`);
