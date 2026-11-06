import { expect, test } from "bun:test";
import { scanText } from "../scripts/personal-scan.ts";
import { isPublic } from "../scripts/public-tree.ts";

const hits = (text: string) => scanText("f.ts", text, []).map((h) => h.replace(/^f\.ts:\d+: /, ""));

test("a key, a token and a private key block are hits", () => {
  const block = ["-----BEGIN", "OPENSSH PRIVATE KEY-----"].join(" ");
  expect(hits(block)).toEqual(["private key"]);
  expect(hits(`token=${"ghp_"}${"a".repeat(36)}`)).toEqual(["GitHub token"]);
  expect(hits(`k = "${"AKIA"}${"A".repeat(16)}"`)).toEqual(["AWS key id"]);
});

test("a real e-mail, a real home folder and a tailnet address are hits, the neutral ones are not", () => {
  expect(hits(`write to someone${"@"}company.dev`)).toEqual(["e-mail address"]);
  expect(hits("write to a@example.com or git@github.com:x/y.git")).toEqual([]);
  expect(hits(`cd ${"/home"}/alice/code`)).toEqual(["home folder of a real user"]);
  expect(hits("cd /home/user/code and docs/brand/home/x.png")).toEqual([]);
  expect(hits(`ssh 100.${101}.102.103`)).toEqual(["tailnet address"]);
});

test("a word of the list is a hit in any case, with its line number", () => {
  expect(scanText("f.ts", "ok\nthe Machine-Q box", ["machine-q"])).toEqual(['f.ts:2: personal word "machine-q"']);
});

test("the working notes do not ship", () => {
  expect(isPublic("docs/numbers.md")).toBe(false);
  expect(isPublic("docs/u39/after/home.webp")).toBe(false);
  expect(isPublic("docs/public-roadmap.md")).toBe(false);
  expect(isPublic("docs/idea.md")).toBe(true);
});
