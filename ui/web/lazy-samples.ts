// Sample data lives in ui/test/ and loads only on a `?state=` page, so a real run carries none of it.
const loaded = new URLSearchParams(location.search).has("state")
  ? {
      page: await import("../test/samples.ts"),
      browser: await import("../test/browser-samples.ts"),
      roadmap: await import("../test/roadmap-samples.ts"),
      chat: await import("../test/chat-samples.ts"),
      settings: await import("../test/settings-samples.ts"),
    }
  : undefined;

/** The sample modules; only a `?state=` page calls it. */
export function samples() {
  if (!loaded) throw new Error("Sample data is read on a ?state= page only.");
  return loaded;
}
