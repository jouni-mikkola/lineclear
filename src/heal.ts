import { dispatcherMain } from "./dispatcher.ts";
import { stepRecord } from "./step-page.ts";

// What the web server runs in a process of its own: `bun src/heal.ts dispatcher|step <project>/<step>` prints the result as JSON.

const [what] = process.argv.slice(2);
if (what === "dispatcher") {
  console.log(JSON.stringify({ code: dispatcherMain(["setup"], () => {}, process.env) }));
} else if (what === "step" && process.argv[3]) {
  const [project = "", step = ""] = process.argv[3].split("/");
  console.log(JSON.stringify(stepRecord(project, step)));
} else {
  console.error("usage: bun src/heal.ts dispatcher|step <project>/<step>");
  process.exit(2);
}
