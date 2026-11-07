import { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileKey, keptBy, readJsonKept } from "./kept-read.ts";

/** One chat's log as the server keeps it. Cards stay untyped here: each reader looks at the few fields it needs. */
type ChatLogRows = { posted: any[]; answers: Record<string, number>; said?: Record<string, unknown> };

/** A chat's name (its key with the characters a path dislikes made `_`) and its log. */
export type ChatFile = { name: string; log: ChatLogRows };

/** What store.sqlite and its log are now: changes when a row is written. */
const storeKey = (dir: string) => `${fileKey(join(dir, "store.sqlite"))}|${fileKey(join(dir, "store.sqlite-wal"))}`;

type Row = { chat: string; kind: string; id: string; json: string };

function fromTable(dir: string, archived: number): ChatFile[] {
  const file = join(dir, "store.sqlite");
  if (!existsSync(file)) return [];
  let db: Database | undefined;
  try {
    db = new Database(file, { readonly: true });
    if (!db.query("select 1 from sqlite_master where name = 'chatlog'").get()) return [];
    const rows = db.query("select chat, kind, id, json from chatlog where archived = ? order by n").all(archived) as Row[];
    const chats = new Map<string, ChatLogRows>();
    for (const r of rows) {
      const log = chats.get(r.chat) ?? { posted: [], answers: {} };
      chats.set(r.chat, log);
      const value = JSON.parse(r.json);
      if (r.kind === "posted") log.posted.push(value);
      else if (r.kind === "answer") log.answers[r.id] = value;
      else (log.said ??= {})[r.id] = value;
    }
    return [...chats].map(([name, log]) => ({ name, log }));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/** The files of a folder a server has not imported yet. */
function fromFolder(folder: string): ChatFile[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).flatMap((f) => {
    const log = f.endsWith(".json") ? readJsonKept<ChatLogRows>(join(folder, f)) : undefined;
    return log === undefined ? [] : [{ name: f.slice(0, -5), log }];
  });
}

/**
 * The chat logs in `dir`: the rows of store.sqlite, and the files of chatlog/ in a folder no server has imported yet.
 * `archived`: the ones of retired tasks. The rows are read again only when one was written.
 */
export function readChatLogs(dir: string, archived = false): ChatFile[] {
  const rows = keptBy(`chats:${archived}:${dir}`, storeKey(dir), () => fromTable(dir, archived ? 1 : 0));
  const taken = new Set(rows.map((r) => r.name));
  return [...rows, ...fromFolder(join(dir, archived ? join("archive", "chatlog") : "chatlog")).filter((f) => !taken.has(f.name))];
}
