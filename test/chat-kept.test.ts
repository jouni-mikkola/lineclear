import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChatLogs } from "../src/chat-kept.ts";

test("the chat logs are read from the chatlog table, live and archived apart, cards in the order posted", () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-kept-"));
  const db = new Database(join(dir, "store.sqlite"), { create: true });
  db.exec(
    "create table chatlog (n integer primary key, chat text not null, kind text not null, id text not null, json text not null, archived integer not null default 0, unique (chat, kind, id))",
  );
  const put = db.query("insert into chatlog (chat, kind, id, json, archived) values (?, ?, ?, ?, ?)");
  put.run("A-1_Agent", "posted", "b", JSON.stringify({ id: "b", at: 2 }), 0);
  put.run("A-1_Agent", "posted", "a", JSON.stringify({ id: "a", at: 1 }), 0);
  put.run("A-1_Agent", "answer", "q", "1", 0);
  put.run("A-1_Agent", "said", "q", JSON.stringify({ text: "hi" }), 0);
  put.run("A-0_Agent", "posted", "z", JSON.stringify({ id: "z", at: 0 }), 1);
  db.close();
  const live = readChatLogs(dir);
  expect(live.map((c) => c.name)).toEqual(["A-1_Agent"]);
  const log = live[0]?.log;
  expect(log?.posted.map((p) => p.id)).toEqual(["b", "a"]);
  expect(log?.answers).toEqual({ q: 1 });
  expect(log?.said).toEqual({ q: { text: "hi" } });
  expect(readChatLogs(dir, true).map((c) => c.name)).toEqual(["A-0_Agent"]);
});
