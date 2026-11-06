/** Words that mark text a model wrote on autopilot. */
const AI_WORDS = ["across", "leverage", "robust", "seamless", "delve", "comprehensive", "ensure"];

/** The rule every prompt gives for what Lineclear writes in git and on pull requests. */
export const PROSE_RULE =
  "Commit messages, pull request titles and bodies, review comments and changelog lines: short plain English, one point per line, " +
  "no en or em dashes, no semicolons, and none of these words: " +
  AI_WORDS.join(", ") +
  ".";

/** What is wrong with a commit message, a pull request text or a changelog line, one fault per entry. */
export function proseFaults(text: string): string[] {
  const faults: string[] = [];
  if (/[\u2013\u2014]/.test(text)) faults.push("an en or em dash");
  if (text.includes(";")) faults.push("a semicolon");
  for (const w of AI_WORDS) if (new RegExp(`\\b${w}(s|d)?\\b`, "i").test(text)) faults.push(`the word "${w}"`);
  return faults;
}
