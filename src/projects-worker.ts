import { readProjects } from "./projects-feed.ts";

// The worker of projects-feed.ts: reads the projects once every `every` ms and posts each snapshot.
declare const self: Worker;

let timer: ReturnType<typeof setTimeout> | undefined;
let every = 1_000;

const loop = () => {
  clearTimeout(timer);
  try {
    self.postMessage({ projects: readProjects(process.env, Date.now()) });
  } catch (err) {
    self.postMessage({ error: (err as Error).message });
  }
  timer = setTimeout(loop, every);
};

self.onmessage = (e: MessageEvent<{ every?: number; now?: true }>) => {
  every = e.data.every ?? every;
  if (e.data.every || e.data.now) loop();
};
