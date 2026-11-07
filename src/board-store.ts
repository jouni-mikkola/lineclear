import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { openStore } from "../server/server/store.ts";
import { dataDir } from "./paths.ts";

const boardFile = (env: NodeJS.ProcessEnv) => join(dataDir(env), "store.sqlite");

/** The folders of the board's spaces, by name, read from its store: no board command is started. None when the board has no store yet. */
export function boardSpaces(env: NodeJS.ProcessEnv): { name: string; path: string }[] {
  const file = boardFile(env);
  if (!existsSync(file)) return [];
  let store: Database | undefined;
  try {
    store = new Database(file, { readonly: true });
    const rows = store.query("select data from spaces order by position").all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as { name: string; path: string });
  } catch (e) {
    if (/no such table/.test(String(e))) return []; // the board has no spaces yet
    throw e;
  } finally {
    store?.close();
  }
}

/** Gives a board that has no settings yet these values at its Everywhere level, in its `settings` table; a board with settings is left as it is. */
export function defaultEverywhere(env: NodeJS.ProcessEnv, values: Record<string, string>): void {
  const home = dataDir(env);
  // an old settings.json is imported by the board at its start, so it counts as settings
  if (existsSync(join(home, "settings.json")) || existsSync(join(home, "settings.json.imported"))) return;
  const store = openStore(boardFile(env));
  try {
    store.exec("create table if not exists settings (level text not null, key text not null, value text not null, primary key (level, key))");
    store
      .transaction(() => {
        if (store.query("select 1 from settings limit 1").get() !== null) return;
        const put = store.query("insert into settings (level, key, value) values ('all', ?, ?)");
        for (const [k, v] of Object.entries(values)) put.run(k, v);
      })
      .immediate();
  } finally {
    store.close();
  }
}
