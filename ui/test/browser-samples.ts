import type { Browser } from "../kit/index.ts";
import type { PageState } from "../web/states.ts";

// Sample browsers for each state of the Agent browsers view (`?state=`), with still pictures drawn here, so their
// screenshots are the same on every machine.

type Kind = "login" | "shop" | "docs" | "chart";

const svg = (body: string, bg: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800"><rect width="1280" height="800" fill="${bg}"/>${body}</svg>`)}`;

const bar = (fg: string) =>
  `<rect x="0" y="0" width="1280" height="64" fill="${fg}" opacity="0.08"/><rect x="40" y="22" width="120" height="20" rx="4" fill="${fg}" opacity="0.5"/>`;

/** A still picture of a kind of page, as a browser would show it. */
function samplePicture(kind: Kind): string {
  if (kind === "login") {
    return svg(
      `${bar("#202020")}<rect x="440" y="170" width="400" height="440" rx="14" fill="#ffffff" stroke="#d9d6d0"/>` +
        `<circle cx="640" cy="240" r="28" fill="#3d5afe" opacity="0.85"/><rect x="520" y="292" width="240" height="18" rx="4" fill="#202020" opacity="0.7"/>` +
        `<rect x="480" y="350" width="320" height="48" rx="8" fill="none" stroke="#bdb9b2" stroke-width="2"/><rect x="480" y="418" width="320" height="48" rx="8" fill="none" stroke="#bdb9b2" stroke-width="2"/>` +
        `<rect x="480" y="500" width="320" height="52" rx="8" fill="#3d5afe"/>`,
      "#f1efeb",
    );
  }
  if (kind === "shop") {
    const tiles = [0, 1, 2, 3, 4, 5, 6, 7]
      .map(
        (i) =>
          `<rect x="${60 + (i % 4) * 300}" y="${130 + Math.floor(i / 4) * 320}" width="260" height="190" rx="10" fill="#e4e0d8"/><rect x="${60 + (i % 4) * 300}" y="${336 + Math.floor(i / 4) * 320}" width="${150 + (i % 3) * 30}" height="16" rx="4" fill="#3a3835" opacity="0.6"/><rect x="${60 + (i % 4) * 300}" y="${364 + Math.floor(i / 4) * 320}" width="70" height="16" rx="4" fill="#c2410c" opacity="0.8"/>`,
      )
      .join("");
    return svg(`${bar("#202020")}${tiles}`, "#faf9f7");
  }
  if (kind === "docs") {
    const lines = Array.from(
      { length: 14 },
      (_, i) => `<rect x="360" y="${150 + i * 40}" width="${520 + ((i * 97) % 300)}" height="14" rx="4" fill="#d8d6d0" opacity="${i % 5 === 0 ? 0.9 : 0.45}"/>`,
    ).join("");
    const side = Array.from(
      { length: 10 },
      (_, i) => `<rect x="48" y="${120 + i * 44}" width="${120 + ((i * 53) % 90)}" height="12" rx="4" fill="#d8d6d0" opacity="0.35"/>`,
    ).join("");
    return svg(`${bar("#ffffff")}<rect x="0" y="64" width="300" height="736" fill="#ffffff" opacity="0.03"/>${side}${lines}`, "#1b1d22");
  }
  const bars = Array.from({ length: 12 }, (_, i) => {
    const h = 80 + ((i * 137) % 260);
    return `<rect x="${100 + i * 90}" y="${620 - h}" width="56" height="${h}" rx="4" fill="#0f766e" opacity="${0.5 + (i % 3) * 0.2}"/>`;
  }).join("");
  return svg(`${bar("#202020")}<rect x="60" y="110" width="1160" height="560" rx="12" fill="#ffffff" stroke="#e2dfd9"/>${bars}`, "#f4f3f0");
}

const KINDS: Kind[] = ["login", "shop", "docs", "chart"];

const LONG = "Move the whole settings page onto the new form parts and keep every saved value, including the ones from before the rename";
const LONG_NAME = "a-project-with-a-very-long-repository-name-that-goes-on-and-on";

export function browserSamples(state: PageState): Browser[] {
  const base: Browser[] = [
    {
      session: "WEB-1",
      title: "Pay with a saved card",
      task: "WEB-1",
      project: "web-shop",
      waits: { item: "3", question: "Sign in to the payment provider's test dashboard, so the agent can make a test key." },
      page: { title: "Sign in", url: "https://dashboard.example-payments.com/login" },
      taken: false,
    },
    {
      session: "WEB-2",
      title: "Search that forgives typos",
      task: "WEB-2",
      project: "web-shop",
      page: { title: "Search results for 'sneakres'", url: "http://localhost:5173/search?q=sneakres" },
      taken: false,
    },
    {
      session: "API-1-review",
      title: "Retry failed webhooks",
      task: "API-1",
      project: "billing-api",
      note: "review",
      page: { title: "Webhooks · API docs", url: "http://localhost:4000/docs/webhooks" },
      taken: false,
    },
    { session: "docs-preview", title: "docs-preview", page: { title: "Delivery times", url: "http://localhost:8080/delivery" }, taken: true },
  ];
  if (state === "long") {
    const [first, ...rest] = base as [Browser, ...Browser[]];
    return [
      {
        ...first,
        session: "WEB-1-a-very-long-session-name-for-the-second-browser",
        note: "a very long session name for the second browser",
        title: LONG,
        project: LONG_NAME,
        waits: { item: "3", question: `${LONG}? Sign in with the shared test account first, then the agent goes on.` },
        page: { title: LONG, url: `https://dashboard.example-payments.com/login?return=${"/settings/forms".repeat(12)}` },
      },
      ...rest,
    ];
  }
  if (state === "many") {
    const words = ["Fix", "Add", "Move", "Check", "Split", "Name", "Test", "Measure", "Drop", "Speed up"];
    const things = ["the login form", "the import", "the merge lane", "the usage chart", "a flaky test", "the inbox card", "the doctor", "the install"];
    return Array.from({ length: 200 }, (_, i) => ({
      session: `T-${i + 1}`,
      title: `${words[i % words.length]} ${things[(i * 7) % things.length]}`,
      task: `T-${i + 1}`,
      project: ["web-shop", "billing-api", "docs-site"][i % 3],
      ...(i % 40 === 0 ? { waits: { item: String(i), question: "Sign in to the test account." } } : {}),
      page: { title: "Page", url: `http://localhost:${5000 + i}/` },
      taken: false,
    }));
  }
  return state === "empty" ? [] : base;
}

/** The sample picture of one sample browser. */
export const samplePictureOf = (b: Browser) =>
  samplePicture(b.waits ? "login" : KINDS[[...b.session].reduce((s, c) => s + c.charCodeAt(0), 0) % KINDS.length]!);
