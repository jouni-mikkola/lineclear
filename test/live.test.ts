import { expect, test } from "bun:test";
import { liveHub, wantedViews } from "../src/live.ts";

const stubApi = (state: { tasks: { id: string; state: string }[] }, calls: string[]) => async (req: Request) => {
  calls.push(new URL(req.url).pathname);
  return Response.json(state);
};

const frames = async (res: Response, until: (text: string) => boolean) => {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  let text = "";
  const dec = new TextDecoder();
  while (!until(text)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
  }
  await reader.cancel();
  return text;
};

test("a revision comes with each read, and moves only when the answer changes", async () => {
  const state = { tasks: [{ id: "A-1", state: "work" }] };
  const hub = liveHub(stubApi(state, []), undefined, 20, 0);
  expect((await hub.read("/api/home"))?.rev).toBe(1);
  expect((await hub.read("/api/home"))?.rev).toBe(1);
  state.tasks[0] = { id: "A-1", state: "done" };
  expect((await hub.read("/api/home"))?.rev).toBe(2);
});

test("one changed task is one small patch, and the page reads nothing again", async () => {
  const state = { tasks: Array.from({ length: 50 }, (_, i) => ({ id: `A-${i}`, state: "work" })) };
  const calls: string[] = [];
  const hub = liveHub(stubApi(state, calls), undefined, 20, 0);
  const rev = (await hub.read("/api/home"))?.rev ?? 0;
  const ctl = new AbortController();
  const res = hub.stream(new Map([["/api/home", rev]]), ctl.signal);
  const reading = frames(res, (t) => t.includes("event: patch"));
  await Bun.sleep(30);
  state.tasks[3] = { id: "A-3", state: "done" };
  const text = await reading;
  ctl.abort();
  expect(text).not.toContain("event: full");
  const data = text.split("data: ")[1]?.split("\n")[0] ?? "";
  expect(JSON.parse(data)).toEqual({ path: "/api/home", rev: rev + 1, ops: [{ p: ["tasks", 3, "state"], v: "done" }] });
  expect(data.length).toBeLessThan(120);
});

test("a page behind gets the whole answer once", async () => {
  const hub = liveHub(stubApi({ tasks: [] }, []), undefined, 1000, 0);
  const ctl = new AbortController();
  const text = await frames(hub.stream(new Map([["/api/inbox", 0]]), ctl.signal), (t) => t.includes("event: full"));
  ctl.abort();
  expect(text).toContain('"rev":1');
});

test("only live answers are streamed", () => {
  const q = new URLSearchParams("v=/api/home&r=3&v=/api/secrets&r=1&v=/api/roadmap/x&r=0");
  expect([...wantedViews(q)]).toEqual([
    ["/api/home", 3],
    ["/api/roadmap/x", 0],
  ]);
});

test("a restarted server counts its revisions from a later start, so an older page gets the whole answer", async () => {
  const before = await liveHub(stubApi({ tasks: [] }, []), undefined, 1000, 100).read("/api/home");
  const after = await liveHub(stubApi({ tasks: [] }, []), undefined, 1000, 200).read("/api/home");
  expect(after?.rev).toBeGreaterThan(before?.rev ?? 0);
});
