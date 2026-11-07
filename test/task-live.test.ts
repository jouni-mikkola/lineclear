import { expect, test } from "bun:test";
import { PAGE_TOKEN } from "../src/web.ts";
import { startFakeLineclear } from "../ui/test/fake-lineclear-server.ts";
import { freshWebApi, waitFor } from "./helpers.ts";

const origin = "http://127.0.0.1:7420";
const get = (path: string) => new Request(`${origin}${path}`);
const post = (path: string, body: unknown, token = true) =>
  new Request(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-lineclear-token": PAGE_TOKEN } : {}) },
    body: JSON.stringify(body),
  });

test("the terminal shows the screen and takes words and keys from own pages only", async () => {
  const fake = startFakeLineclear({ task: true });
  try {
    const { handle } = freshWebApi(fake.url);
    let view: { state: string; ansi: string } = { state: "", ansi: "" };
    await waitFor(async () => {
      view = await (await handle(get("/api/task/WEB-3/terminal"))).json();
      return view.state === "ready";
    }, "the terminal to be ready");
    expect(view.ansi).toContain("ready");
    expect((await handle(post("/api/task/WEB-3/terminal/input", { text: "yes", enter: true }))).status).toBe(202);
    expect((await handle(post("/api/task/WEB-3/terminal/input", { keys: ["esc"] }))).status).toBe(202);
    expect((await handle(post("/api/task/WEB-3/terminal/input", { keys: ["rm"] }))).status).toBe(400);
    expect((await handle(post("/api/task/WEB-3/terminal/input", {}, false))).status).toBe(403);
    expect(fake.actions.map((a) => a.type)).toEqual(["text", "keys", "keys"]);
  } finally {
    fake.stop();
  }
});

test("without the board server the terminal says so", async () => {
  const { handle } = freshWebApi();
  expect(((await (await handle(get("/api/task/WEB-3/terminal"))).json()) as { state: string }).state).toBe("offline");
});
