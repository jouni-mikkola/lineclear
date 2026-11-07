export {};
// A projects worker that fails as soon as it is told to read.
declare const self: Worker;

self.onmessage = () => self.postMessage({ error: "no settings" });
