import { dispatcherMain } from "./dispatcher.ts";
import { realProbe } from "./doctor.ts";
import { pathsFor } from "./paths.ts";
import { fixRetired } from "./retire.ts";
import { stepRecord } from "./step-page.ts";
import { noticeTimers } from "./inbox.ts";

// What the web server fixes by itself, in a process of its own: `bun src/heal.ts heal|fix|dispatcher|step <project>/<step>` prints the result
// as JSON. `heal` and `fix` apply every safe fix of this machine's doctor; `fix` also says what it did.

const [what] = process.argv.slice(2);
if (what === "dispatcher") {
  console.log(JSON.stringify({ code: dispatcherMain(["setup"], () => {}, process.env) }));
} else if (what === "heal" || what === "fix") {
  const lines: string[] = [];
  const code = fixRetired(realProbe(pathsFor(process.env), process.env), (l) => lines.push(l), what === "heal" ? noticeTimers : undefined);
  console.log(JSON.stringify({ code, fixed: lines }));
} else if (what === "step" && process.argv[3]) {
  const [project = "", step = ""] = process.argv[3].split("/");
  console.log(JSON.stringify(stepRecord(project, step)));
} else {
  console.error("usage: bun src/heal.ts heal|fix|dispatcher|step <project>/<step>");
  process.exit(2);
}
