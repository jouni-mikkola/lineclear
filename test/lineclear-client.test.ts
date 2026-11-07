// The board-server client against a fake server: the snapshot, the chat key of a task and the actions.
import { afterAll, expect, test } from "bun:test";
import { postAction, readSnapshot, lineclearServer, taskChatKey } from "../src/lineclear-client.ts";

const posted: unknown[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/api/snapshot") return Response.json({ tasks: [{ id: "T-1", agent: { chat: "chat-1" } }, { id: "T-2" }] });
    if (path === "/api/action") {
      const body = (await req.json()) as { type?: string };
      posted.push(body);
      return body.type === "refused" ? Response.json({ ok: false, error: "no" }) : Response.json({ ok: true });
    }
    return new Response("", { status: 404 });
  },
});
afterAll(() => server.stop(true));
const base = `http://127.0.0.1:${server.port}`;

test("the server is found by the url setting", () => {
  expect(lineclearServer({ LINECLEAR_URL: "http://x:1//" })).toBe("http://x:1");
});

test("the snapshot gives the chat key of a task, and none for a task without one", async () => {
  const snap = await readSnapshot(base);
  expect(taskChatKey(snap as never, "T-1")).toBe("chat-1");
  expect(taskChatKey(snap as never, "T-2")).toBeUndefined();
  expect(await readSnapshot("http://127.0.0.1:1")).toBeUndefined();
});

test("an action goes through, is refused with the reason, or finds the server away", async () => {
  expect(await postAction(base, { type: "ok" }, 2000, "away", "slow")).toBeUndefined();
  expect(posted).toEqual([{ type: "ok" }]);
  expect(await postAction(base, { type: "refused" }, 2000, "away", "slow")).toEqual({ error: "no", status: 502 });
  expect(await postAction("http://127.0.0.1:1", { type: "ok" }, 2000, "away", "slow")).toEqual({ error: "away", status: 503 });
});
