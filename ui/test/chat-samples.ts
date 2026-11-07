import type { ChatMessage, ChatView } from "../../src/chat.ts";
import type { PlanCard } from "../../src/web.ts";
import type { Attached } from "../kit/index.ts";
import type { ChatState } from "../web/states.ts";

// Sample chats for each state of the Chat view (`?state=`), so their screenshots are the same on every machine. The
// Chat view has five states more than the others: sending, streaming, offline, none, and request (one request from a
// sentence to a plan to approve).

const svg = (body: string, w = 640, h = 400) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;

/** A still picture of a checkout page with a broken button, as a screenshot would show it. */
const SAMPLE_SHOT = svg(
  `<rect width="640" height="400" fill="#f4f3f0"/><rect width="640" height="44" fill="#202020" opacity="0.08"/><rect x="24" y="14" width="90" height="16" rx="4" fill="#202020" opacity="0.5"/>` +
    `<rect x="40" y="80" width="340" height="18" rx="4" fill="#3a3835" opacity="0.7"/><rect x="40" y="116" width="260" height="12" rx="4" fill="#3a3835" opacity="0.35"/>` +
    `<rect x="40" y="150" width="560" height="56" rx="8" fill="#ffffff" stroke="#d9d6d0"/><rect x="40" y="222" width="560" height="56" rx="8" fill="#ffffff" stroke="#d9d6d0"/>` +
    `<rect x="40" y="300" width="200" height="52" rx="8" fill="#9ca3af"/><rect x="72" y="320" width="136" height="12" rx="4" fill="#ffffff" opacity="0.8"/>`,
);

/** A still picture of a burn-down chart the Dispatcher names in an answer. */
const SAMPLE_CHART = svg(
  `<rect width="640" height="320" fill="#161a1d"/>` +
    Array.from({ length: 14 }, (_, i) => {
      const h = 220 - i * 13 - ((i * 37) % 30);
      return `<rect x="${40 + i * 42}" y="${280 - h}" width="28" height="${h}" rx="3" fill="#2fbf71" opacity="${0.45 + (i % 3) * 0.2}"/>`;
    }).join(""),
  640,
  320,
);

let n = 0;
const you = (text: string): ChatMessage => ({ id: `s${n++}`, who: "you", text });
const them = (text: string): ChatMessage => ({ id: `s${n++}`, who: "dispatcher", text });

function talk(): ChatMessage[] {
  n = 0;
  return [
    you("How far is web-shop, and what holds it?"),
    them(
      "**web-shop** is 14 of 30 steps in, in *Phase 2: Checkout*.\n\n" +
        "| Task | State |\n| --- | --- |\n| Pay with a saved card | waits for you |\n| Search that forgives typos | working |\n| Order history page | working |\n\n" +
        "One thing holds it: **Pay with a saved card** asks which payment provider to use. Answer it in the [Inbox](https://example.com/inbox).",
    ),
    you("The pay button looks grey on the review page. Is that the bug?"),
    { id: `s${n++}`, who: "you", file: { name: "checkout-review.png", image: true, size: 182_000, url: SAMPLE_SHOT } },
    them(
      "Yes. The button is disabled until the terms box is ticked, and the box sits below the fold on a phone.\n\n" +
        "Two ways to fix it:\n\n1. Move the terms box above the button.\n2. Tick it for a returning customer who accepted the terms before.\n\n" +
        "The rule lives in `checkout/review.tsx`:\n\n```tsx\nconst canPay = card && terms;\n```\n\nShall I add a step for it to the roadmap?",
    ),
    you("Add it after Pay with a saved card. Here are the notes from the design review."),
    { id: `s${n++}`, who: "you", file: { name: "design-review-notes.pdf", image: false, size: 1_420_000 } },
    them(
      `Added **Terms box above the pay button** to web-shop, after *Pay with a saved card*. The burn-down now ends a day later:\n\n![Burn-down for web-shop](${SAMPLE_CHART})`,
    ),
  ];
}

const LONG_WORDS =
  "Please look at every project that has a step waiting on another project and tell me which of those waits could be cut if we moved the shared parts into one place first, with a_very_long_identifier_that_does_not_break_anywhere_in_the_middle_of_it";

/** The chat as the server would give it, for a sample state. */
export function chatSample(state: ChatState): ChatView {
  if (state === "loading") return { state: "loading", messages: [], writing: false, failed: [] };
  if (state === "none") return { state: "none", reason: "There is no Dispatcher yet.", messages: [], writing: false, failed: [] };
  if (state === "empty") return { state: "ready", messages: [], writing: false, failed: [] };
  const messages = talk();
  if (state === "streaming") {
    return {
      state: "ready",
      messages: [
        ...messages,
        you("What waits for me today?"),
        them("Two things wait for you:\n\n- **web-shop**: Pay with a saved card asks which payment provider to use."),
      ],
      writing: true,
      doing: "Reading billing-api's roadmap",
      failed: [],
    };
  }
  if (state === "long") {
    return {
      state: "ready",
      messages: [
        you(LONG_WORDS),
        them(
          "Three waits could be cut:\n\n" +
            Array.from(
              { length: 3 },
              (_, i) =>
                `${i + 1}. **${["billing-api", "web-shop", "a-project-with-a-very-long-repository-name-that-goes-on-and-on"][i]}** waits on the shared login form, which ${["moves to the design kit first", "can be copied for now", "needs a new owner before anything else, because nobody has touched it in a long while and its tests no longer run"][i]}.`,
            ).join("\n") +
            "\n\n```text\nW14 after B3, B7 and a-project-with-a-very-long-repository-name-that-goes-on-and-on:L2\n```\n\n" +
            "| Project | Waits on | Could start |\n| --- | --- | --- |\n| billing-api | Shared login form | After the kit step |\n| a-project-with-a-very-long-repository-name-that-goes-on-and-on | Shared login form and the session store | Now |",
        ),
        {
          id: "s-long-file",
          who: "you",
          file: { name: "a-very-long-file-name-for-the-export-of-every-roadmap-at-once-2026.csv", image: false, size: 9_800_000 },
        },
      ],
      writing: false,
      failed: [],
    };
  }
  if (state === "many") {
    const many: ChatMessage[] = [];
    for (let i = 0; i < 100; i++)
      many.push(you(`Where does step ${i + 1} stand?`), them(`Step ${i + 1} is ${["done", "working", "queued", "waiting for you"][i % 4]}.`));
    return { state: "ready", messages: many, writing: false, failed: [] };
  }
  if (state === "task") return { state: "ready", messages: taskTalk(), writing: false, failed: [] };
  if (state === "request") return { state: "ready", messages: request(), writing: false, failed: [] };
  return { state: "ready", messages, writing: false, failed: [] };
}

const AT = Date.UTC(2026, 9, 31, 16, 0);

/** One request from a sentence: the Dispatcher asks which project, hands it on, and the plan comes back to approve. */
function request(): ChatMessage[] {
  return [
    { id: "r1", who: "you", text: "Add CSV export to the budget app", at: AT },
    { id: "r2", who: "dispatcher", text: "Which project is this for?", question: { id: "q1", choices: ["budget-app", "budget-api"], sent: 0 }, at: AT + 5_000 },
    { id: "r3", who: "you", text: "budget-app", at: AT + 20_000 },
    {
      id: "r4",
      who: "dispatcher",
      text: "The planner writes the steps for **budget-app** now (task BUD-12). They come to you as one approval, here and in the Inbox.\n\nSee them live: [budget-app roadmap](/budget-app/roadmap/track?plan=BUD-12)",
      at: AT + 30_000,
    },
  ];
}

/** A task\'s chat: the agent asks, you answer, it shows a plan and a picture. */
function taskTalk(): ChatMessage[] {
  return [
    {
      id: "t1",
      who: "dispatcher",
      text: "I read the checkout page. The pay button stays grey until the terms box is ticked.",
      at: AT,
    },
    { id: "t2", who: "you", text: "Move the terms box above the button.", at: AT + 20_000 },
    { id: "t3", who: "dispatcher", text: "Done. Here is how the page looks now.", at: AT + 60_000, reply: { text: "Move the terms box above the button." } },
    { id: "t4", who: "dispatcher", file: { name: "checkout-review.png", image: true, size: 182_000, url: SAMPLE_SHOT }, at: AT + 61_000 },
    {
      id: "t5",
      who: "dispatcher",
      text: "Which way do you want the rest?",
      question: {
        id: "tq1",
        choices: ["Approve the plan", "Change it"],
        steps: ["Move the terms box above the pay button", "Tick it for a returning customer", "Test both on a phone"],
      },
      at: AT + 90_000,
    },
  ];
}

/** The plans the chat shows as cards, for a sample state. */
export function planSamples(state: ChatState): PlanCard[] {
  if (state !== "request") return [];
  const diff = "+### B7 Export a month as CSV\n+- why: a budget is checked in a spreadsheet\n+### B8 Export button on the month view\n+- after: B7";
  return [
    {
      task: "BUD-12",
      project: "budget-app",
      goal: "Add CSV export",
      since: new Date(AT + 30_000).toISOString(),
      by: "dispatcher",
      state: "approve",
      steps: ["B7", "B8"],
      live: "/budget-app/roadmap/track?plan=BUD-12",
      item: {
        id: "7",
        task: "BUD-12",
        kind: "plan",
        project: "budget-app",
        question: "Approve this roadmap change for budget-app?",
        choices: ["Approve", "Reject"],
        details: `Plan to approve, from task BUD-12.\n\n${diff}`,
        needsNote: "Reject",
      },
    },
  ];
}

/** What you sent that has not shown in the chat yet, for a sample state. */
export function chatSamplePending(state: ChatState): { cid: string; text: string; files: Attached[]; status: "sending" | "failed"; error?: string }[] {
  if (state === "sending") {
    return [
      {
        cid: "p1",
        text: "Here is the phone screenshot too.",
        files: [{ id: "f1", name: "phone-review.png", size: 96_000, image: true, url: SAMPLE_SHOT, state: "ready" }],
        status: "sending",
      },
    ];
  }
  if (state === "error") return [{ cid: "p1", text: "Which task is the slowest this week?", files: [], status: "failed", error: "The server did not answer." }];
  return [];
}

/** The composer's files, for a sample state. */
export function chatSampleAttached(state: ChatState): Attached[] {
  if (state === "sending") return [];
  if (state === "filled") {
    return [
      { id: "a1", name: "error-log.txt", size: 12_400, image: false, state: "ready" },
      { id: "a2", name: "settings-page.png", size: 240_000, image: true, url: SAMPLE_SHOT, state: "uploading" },
    ];
  }
  if (state === "long")
    return [
      {
        id: "a3",
        name: "screen-recording.mov",
        size: 48_000_000,
        image: false,
        state: "failed",
        error: "screen-recording.mov cannot be attached. Images (PNG, JPEG, GIF, WebP), PDF and text files can.",
      },
    ];
  return [];
}
