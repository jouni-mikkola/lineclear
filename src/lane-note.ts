/** The merge lane's stall as the owner reads it: a head that hangs, and a task the lane let go. */
/** The lane lets a head go after this long without progress. */
const LANE_IDLE_MS = 15 * 60_000;

/** Steps a head only passes through: a check may run long, these do not. */
const SHORT_STEPS: Record<string, string> = { rebase: "Rebasing", merge: "Merging" };

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/**
 * What the lane says of one task: "Stuck in <step> for <n> min" for a head hanging in a short step, or
 * "Released from the merge line: <reason>" once the lane let it go, until it joins the line again or merges.
 */
export function laneNote(
  task: { landing?: { step?: string; at?: number }; mergeStopped?: string; laneReleased?: string; merged?: boolean },
  now: number,
): string | undefined {
  if (task.merged) return undefined;
  const { landing } = task;
  if (landing) {
    const step = SHORT_STEPS[landing.step ?? ""];
    const quiet = typeof landing.at === "number" ? now - landing.at : 0;
    return step && quiet >= LANE_IDLE_MS ? `Stuck in "${step}" for ${minutes(quiet)} min` : undefined;
  }
  if (task.laneReleased) return `Released from the merge line: ${task.laneReleased}`;
  const released = /^Your merge hung in (.*?),? so the merge lane released it/.exec(task.mergeStopped ?? "");
  if (released?.[1]) return `Released from the merge line: hung in ${released[1]}`;
  return task.mergeStopped ? `Merge stopped: ${task.mergeStopped}` : undefined;
}
