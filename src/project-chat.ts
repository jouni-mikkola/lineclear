import { readChatLogs } from "./chat-kept.ts";
import { lineclearDir } from "./measure.ts";
import { serverBin } from "./paths.ts";
import { readSettings } from "./project.ts";

/** Puts a card in a chat. Returns an error text, or undefined. */
export type CardPoster = (chat: string, title: string, choices: string[], env: NodeJS.ProcessEnv) => string | undefined;

/** The chat key of a project's chat (its space's coordinator chat), from the chat logs. */
function projectChat(project: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  const settings = project === undefined ? undefined : readSettings(project, env);
  if (settings === undefined || typeof settings === "string") return undefined;
  return readChatLogs(lineclearDir(env)).find((c) => c.name.startsWith("p_") && c.name.endsWith(`_${settings.space}`))?.name;
}

const postCard: CardPoster = (chat, title, choices, env) => {
  const r = Bun.spawnSync([serverBin(env), "card", title, ...choices.flatMap((c) => ["--choice", c])], {
    stdin: "ignore",
    env: { ...env, LINECLEAR_CHAT: chat },
  });
  return r.exitCode === 0 ? undefined : (r.stderr.toString() || r.stdout.toString()).trim() || `exit ${r.exitCode}`;
};

/**
 * A task's ask or owner wait as a card in its project's chat. The card names the task, which is how the rule loop
 * finds it: a rule or the Dispatcher answers it, and only an owner matter becomes an Inbox item and a push.
 * False when the project has no chat or the card did not post, so the caller keeps the Inbox item.
 */
export function askProjectChat(
  project: string | undefined,
  task: string,
  question: string,
  choices: string[],
  env: NodeJS.ProcessEnv,
  post: CardPoster = postCard,
): boolean {
  const chat = projectChat(project, env);
  return chat !== undefined && post(chat, `${task}: ${question}`, choices, env) === undefined;
}
