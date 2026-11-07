export {};
// A projects worker that publishes one snapshot, then blocks its thread for 5 s on every later read, as a tick full of
// Bun.spawnSync calls would.
declare const self: Worker;

self.onmessage = () => {
  self.postMessage({ projects: [] });
  for (;;) {
    Bun.sleepSync(5_000);
    self.postMessage({ projects: [] });
  }
};
