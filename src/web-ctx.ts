import type { browsers } from "./browsers.ts";
import type { dispatcherChat } from "./chat.ts";
import type { HomeData } from "./home-data.ts";
import type { Pusher } from "./notify.ts";
import type { Aside } from "./read-aside.ts";
import type { RoadmapRead } from "./roadmap-view.ts";
import type { taskTerminalLinks } from "./task-live.ts";
import type { Env } from "./web-guard.ts";

/** What the routes share: the kept reads, the caches a write clears, and the pieces that talk to the machine. */
export interface Ctx {
  env: Env;
  now: () => number;
  aside: Aside;
  push?: Promise<Pusher>;
  readProjects: (t: number) => Promise<HomeData["projects"]>;
  forgetProjects: () => void;
  forgetRoadmap: (name: string) => void;
  roadmap: (name: string) => { ready: (wait?: number) => Promise<RoadmapRead | undefined> };
  warmed: Set<string>;
  live: ReturnType<typeof browsers>;
  dispatcher: () => ReturnType<typeof dispatcherChat>;
  taskChats: (id: string) => ReturnType<typeof dispatcherChat>;
  taskTerminals: ReturnType<typeof taskTerminalLinks>;
}
