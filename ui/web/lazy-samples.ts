// The samples of the lazy views load only on a `?state=` page, so the first scripts of a real run do not carry them.
export const lazySamples = new URLSearchParams(location.search).has("state")
  ? { chat: await import("./chat-samples.ts"), settings: await import("./settings-samples.ts") }
  : undefined;
