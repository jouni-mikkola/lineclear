import { expect, test } from "bun:test";
import { embeddedPictures, shotsIn, shotsList, strayPictures } from "../src/shots.ts";

const LISTED = ["home-1440.png", "home-390.png"];

test("the list names each picture and reads back", () => {
  expect(shotsIn(shotsList(LISTED))).toEqual(LISTED);
  expect(shotsList(LISTED)).toContain("- `home-390.png`: Home at 390 px");
});

test("pictures are found in Markdown and in HTML, and web links are not pictures of the app", () => {
  const text = `![a](x/one.png "t") <img src="two.png" alt="b" width="9"> ![c](https://example.com/c.png)`;
  expect(embeddedPictures(text)).toEqual([
    { src: "x/one.png", alt: "a" },
    { src: "two.png", alt: "b" },
  ]);
});

test("a listed screenshot, the mark and a captioned direction pass", () => {
  expect(strayPictures("README.md", `<img src="docs/shots/home-1440.png" alt="">`, LISTED)).toEqual([]);
  expect(strayPictures("docs/design.md", `![](shots/home-390.png)`, LISTED)).toEqual([]);
  expect(strayPictures("README.md", `<img src="docs/readme/line.svg" alt="">`, LISTED)).toEqual([]);
  expect(strayPictures("docs/brand.md", `![Direction: The line](brand/home/direction-line.png)`, LISTED)).toEqual([]);
});

test("a picture of the app that is not in the list fails, as does an uncaptioned direction", () => {
  expect(strayPictures("README.md", `<img src="docs/shots/inbox-390.png" alt="">`, LISTED)).toHaveLength(1);
  expect(strayPictures("README.md", `![](ui/test/screens/home-filled-1440.png)`, LISTED)).toHaveLength(1);
  expect(strayPictures("docs/brand.md", `![The line](brand/home/direction-line.png)`, LISTED)).toHaveLength(1);
});
