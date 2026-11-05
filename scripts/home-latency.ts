// Polls the live service's /api/home once a second and prints the answers and the slowest one.
// Usage: bun scripts/home-latency.ts <minutes> [url]
const minutes = Number(process.argv[2] ?? 10);
const url = process.argv[3] ?? "http://127.0.0.1:7420/api/home";
const end = Date.now() + minutes * 60_000;
const times: number[] = [];
while (Date.now() < end) {
  const start = performance.now();
  await (await fetch(url)).arrayBuffer();
  times.push(performance.now() - start);
  await Bun.sleep(1000);
}
console.log(`${times.length} answers, slowest ${Math.round(Math.max(...times))} ms`);

export {};
