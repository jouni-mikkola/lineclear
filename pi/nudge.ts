// The nudge a quiet turn gets, said by the rule loop (src/asks.ts); the server answers a quiet turn, not the agent.

/** Its last message promises the next action instead of taking it or declaring a wait. */
export const promisesNext = (reply: string) =>
  /\b(i['’]?ll|i will|i am going to|i['’]?m going to)\s+(keep|continue|try|check|call|run|retry|wait|look|come back|monitor|poll)/i.test(reply);

/** The nudge an idle agent gets for each quiet turn. */
export const IDLE_NUDGE =
  'Your turn ended with no question and no declared wait, so you are not in the owner\'s Inbox. If you are done, run `lineclear ready` (or `lineclear done` when nothing changed). If you wait for the owner (only a login code, money beyond the budget, or something that leaves the machine), run `lineclear wait owner --kind login|money|outward "<what you need>"`. Otherwise carry on with your task.';

/** The nudge for a reply that promised its next action. */
export const PROMISE_NUDGE =
  'Your turn ended with a promise of the next action ("I\'ll keep calling", "I\'ll check again") and no declared wait. Run that action now. If it cannot run yet, declare the wait with `lineclear wait task|until|owner ...` and end your turn.';

/** The answer to an ordinary question an agent ended its turn with. */
export const DECIDE_TEXT =
  "Decide yourself by the brief: the owner is not asked this. Take the safer choice, list the decision in your facts, and carry on. Only a login code, money beyond the budget, or something that leaves the machine goes to the owner.";

/** The nudge for a quiet turn in Merging: a merge left running holds every merge behind it in the lane. */
export const mergeNudge = (task: string) =>
  `Your turn ended while your merge is still in progress, and it holds every merge behind it. Run \`lineclear merge ${task}\` again, in the foreground, and wait for its answer until the task is through.`;
