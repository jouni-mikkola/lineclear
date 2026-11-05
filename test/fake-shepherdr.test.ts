import { expect, test } from "bun:test";
import { startFakeShepherdr } from "../ui/test/fake-shepherdr-server.ts";

test("the fake board keeps the chat it is given, lists no actions yet, and answers an unknown path with 404", async () => {
  const fake = startFakeShepherdr();
  try {
    const set = await fetch(`${fake.url}/fake/chat`, { method: "POST", body: JSON.stringify({ key: "k", messages: [], cli: "pi" }) });
    expect(set.status).toBe(200);
    expect(await (await fetch(`${fake.url}/fake/actions`)).json()).toEqual([]);
    expect((await fetch(`${fake.url}/nowhere`)).status).toBe(404);
  } finally {
    fake.stop();
  }
});
