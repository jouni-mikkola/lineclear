import { doneItems } from "./doneproof.ts";
import { addItem, readItems } from "./inbox.ts";
import type { Step } from "./roadmap.ts";
import type { State, World } from "./rules.ts";

/** What the owner's steps need of a tick. */
interface Ask {
  name: string;
  world: World;
  state: State;
  dryRun: boolean;
  env: NodeJS.ProcessEnv;
  note: (code: "owner", reason: string, step?: string) => void;
}

/** Owner-only steps whose Inbox item the owner answered Done: they count as merged, so the steps after them start. */
export function ownerStepsDone(env: NodeJS.ProcessEnv, state: Pick<State, "ownerItems">, steps: Step[]): string[] {
  const items = readItems(env);
  return steps.filter((s) => s.ownerOnly && items.some((i) => i.n === state.ownerItems?.[s.id] && i.answer === "Done")).map((s) => s.id);
}

/** A ready owner-only step is never a task: it becomes one Inbox item with its done-when, once, until the owner marks it done. */
export function ownerStepItem(a: Ask, step: Step): true {
  const told = a.state.ownerItems?.[step.id];
  if (told !== undefined) {
    a.note("owner", "owner-only step: it waits for your answer in the Inbox", step.id);
    return true;
  }
  if (a.dryRun) {
    a.note("owner", `would put owner-only step ${step.id} in the Inbox`, step.id);
    return true;
  }
  const doneWhen = doneItems(step)
    .map((i) => `- ${i}`)
    .join("\n");
  const item = addItem(
    {
      kind: "choice",
      task: "-",
      project: a.name,
      ownerStep: step.id,
      question: `${step.id} ${step.title} is yours to do by hand. Mark it done with the result. Its done-when:\n${doneWhen}`,
      choices: ["Done"],
      since: a.world.now().toISOString(),
    },
    a.env,
  );
  a.state.ownerItems = { ...a.state.ownerItems, [step.id]: item.n };
  a.note("owner", `owner-only step: Inbox item ${item.n} waits for your answer, no task started`, step.id);
  return true;
}
