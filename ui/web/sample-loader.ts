// Sample data lives in ui/test/ and loads only on a `?state=` page, so a real run carries none of it.
const loaded = new URLSearchParams(location.search).has("state")
  ? await Promise.all([
      import("../test/samples/page.ts"),
      import("../test/samples/browser-samples.ts"),
      import("../test/samples/roadmap-samples.ts"),
      import("../test/samples/chat-samples.ts"),
      import("../test/samples/settings-samples.ts"),
    ]).then(([page, browser, roadmap, chat, settings]) => ({ page, browser, roadmap, chat, settings }))
  : undefined;

/** The sample modules; only a `?state=` page calls it. */
export function samples() {
  if (!loaded) throw new Error("Sample data is read on a ?state= page only.");
  return loaded;
}
