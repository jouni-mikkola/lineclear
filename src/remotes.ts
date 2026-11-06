import { resolve } from "node:path";
import type { BrowserSession } from "./browsers.ts";
import type { HomeProject } from "./home-data.ts";
import type { Item } from "./inbox.ts";
import { readMachines } from "./machine-list.ts";
import { remoteLineclear, remoteLineclearSync } from "./ssh.ts";
import { git } from "./git.ts";

type Env = Record<string, string | undefined>;

// The work of the other machines. Each machine runs its own spaces, tasks and slots on Lineclear and tells what it
// holds with `lineclear export`. This machine reads that over SSH, so every view shows all machines with no file of
// another machine read here.

/** What one machine says about its own work. */
export interface Export {
  host: string;
  /** The commit of the Lineclear code it runs. */
  commit: string;
  projects: HomeProject[];
  /** Its open Inbox items. */
  inbox: Item[];
  /** Its `lineclear status` lines. */
  status: string[];
  browsers: BrowserSession[];
  /** Its load average and load limit, read where it runs. */
  load?: { load: number; limit: number };
  /** True when its helper socket paths differ after migrate, so its agents cannot reach the server. */
  helperApart?: boolean;
}

/** How a machine's commit stands to this one's by git ancestry: the same, older (behind), newer (ahead), or neither (different, or not in this checkout). */
export type Relation = "same" | "behind" | "ahead" | "different";

const relations = new Map<string, Relation>();

export function relationOf(mine: string, theirs: string, repo = resolve(import.meta.dir, "..")): Relation {
  if (mine === theirs) return "same";
  const key = `${repo}:${mine}:${theirs}`;
  const known = relations.get(key);
  if (known) return known;
  const ancestor = (a: string, b: string) => git(repo, "merge-base", "--is-ancestor", a, b).ok;
  const found: Relation = ancestor(theirs, mine) ? "behind" : ancestor(mine, theirs) ? "ahead" : "different";
  relations.set(key, found);
  return found;
}

const REFRESH_MS = 15_000;

function parse(text: string, host: string): Export | null {
  try {
    const e = JSON.parse(text);
    if (!e || typeof e.commit !== "string" || !Array.isArray(e.projects)) return null;
    return {
      ...e,
      host,
      projects: e.projects.map((p: HomeProject) => ({ ...p, name: `${p.name} on ${host}`, machine: host })),
      inbox: e.inbox ?? [],
      status: e.status ?? [],
      browsers: e.browsers ?? [],
    };
  } catch {
    return null;
  }
}

/** One machine's export now, over SSH; null when it cannot be reached or runs a Lineclear that has no export. */
async function fetchExport(host: string, env: Env = process.env): Promise<Export | null> {
  const r = await remoteLineclear(host, ["export"], env, 30_000);
  return r.code === 0 ? parse(r.stdout, host) : null;
}

export function fetchExportSync(host: string, env: Env = process.env): Export | null {
  const r = remoteLineclearSync(host, ["export"], env);
  return r.code === 0 ? parse(r.stdout, host) : null;
}

const cache = new Map<string, { at: number; read: Export | null; busy: boolean }>();

/**
 * The last export of each machine, at once. A machine being updated still shows its work. A read older than 15 s starts again in the background, so
 * a view never waits on SSH; a machine that does not answer shows nothing.
 */
export function remoteExports(env: Env = process.env, now = Date.now()): Export[] {
  const hosts = readMachines(env).map((m) => m.host);
  for (const h of cache.keys()) if (!hosts.includes(h)) cache.delete(h);
  const out: Export[] = [];
  for (const host of hosts) {
    let entry = cache.get(host);
    if (!entry) cache.set(host, (entry = { at: 0, read: null, busy: false }));
    if (!entry.busy && now - entry.at > REFRESH_MS) {
      const e = entry;
      e.busy = true;
      void fetchExport(host, env).then((read) => Object.assign(e, { read, at: Date.now(), busy: false }));
    }
    if (entry.read) out.push(entry.read);
  }
  return out;
}

/** Reads every machine again at the next view: after an answer sent there. */
export function staleRemotes(): void {
  for (const e of cache.values()) e.at = 0;
}

/** Waits until every ready machine has been read once more: for a test and for the first view. */
export async function refreshRemotes(env: Env = process.env): Promise<void> {
  cache.clear();
  const hosts = readMachines(env).map((m) => m.host);
  await Promise.all(hosts.map(async (host) => cache.set(host, { at: Date.now(), read: await fetchExport(host, env), busy: false })));
}
