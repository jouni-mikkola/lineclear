/** Why a skip happened. The loop and the dedupe compare these, never the sentence. */
export type SkipCode = "no-room" | "blocked" | "paused" | "owner" | "broken" | "unreachable";

/** What a decision is: a skip's reason, or the other kinds of decision. At most 12. */
export type DecisionCode = SkipCode | "start" | "stop" | "wake" | "stall" | "close" | "run";

const SKIPS: readonly string[] = ["no-room", "blocked", "paused", "owner", "broken", "unreachable"] satisfies SkipCode[];

export const isSkipCode = (code: string): code is SkipCode => SKIPS.includes(code);

/** The kind a code belongs to. */
export const kindOf = (code: DecisionCode) => (isSkipCode(code) ? ("skip" as const) : code);
