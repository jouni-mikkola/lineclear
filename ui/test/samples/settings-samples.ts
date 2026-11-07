import type { ProjectSettings } from "../../kit/index.ts";
import type { SettingsData } from "../../web/settings-empty.ts";
import type { PageState } from "../../web/states.ts";
import type { SetupView } from "../../../src/setup.ts";

// Sample Settings for each state of the page (`?state=`), so its pictures stay the same on every machine.

const MODELS = {
  worker: ["vendor-a/model-mid", "vendor-b/model-code", "vendor-c/model-pro"],
  reviewer: ["vendor-b/model-code", "vendor-a/model-top"],
  planner: ["vendor-a/model-top", "vendor-c/model-pro"],
};

const R = {
  use: { state: "use", reason: "in use" },
  next: { state: "next", reason: "next, takes over when the ones above are full" },
  full: { state: "full", reason: "account full until 16:00" },
  unreported: { state: "use", reason: "in use, usage not reported" },
};
/** Reasons for the sample lists: the first worker's account is full, so the second is in use. */
const REASONS = {
  worker: [R.full, R.use, R.next],
  reviewer: [R.unreported, R.next],
  planner: [R.use, R.next],
};

function filled(): SettingsData {
  return {
    accounts: [
      { account: "anthropic", kind: "subscription", price: 100, currency: "USD" },
      { account: "openai", kind: "subscription" },
      { account: "openrouter", kind: "key" },
    ],
    projects: [
      {
        name: "web-shop",
        repo: "/home/me/code/web-shop",
        check: "bun run check",
        health: "curl -fsS https://shop.example.com/health",
        models: MODELS,
        reasons: REASONS,
        secrets: ["PAYMENT_TEST_KEY", "SENTRY_DSN"],
      },
      {
        name: "billing-api",
        repo: "/home/me/code/billing-api",
        check: "make check",
        models: { ...MODELS, worker: ["vendor-b/model-code", "vendor-a/model-mid"] },
        reasons: { ...REASONS, worker: [R.use, R.next] },
        secrets: [],
      },
    ],
  };
}

const LONG_CMD = "docker compose run --rm --build app sh -c 'bun install --frozen-lockfile && bun run types && bun run test && bun run lint'";

function long(): SettingsData {
  const f = filled();
  return {
    ...f,
    projects: [
      {
        name: "a-project-with-a-very-long-repository-name-that-goes-on-and-on",
        repo: "/home/me/code/clients/a-project-with-a-very-long-repository-name-that-goes-on-and-on",
        check: LONG_CMD,
        health: "curl -fsS --retry 5 --retry-delay 2 https://a-very-long-service-name.example.com/api/v2/health/ready",
        models: {
          worker: ["openrouter/some-provider/a-model-with-a-really-long-name-and-version-2026-10-01-preview", ...MODELS.worker],
          reviewer: MODELS.reviewer,
          planner: MODELS.planner,
        },
        reasons: { ...REASONS, worker: [R.use, ...REASONS.worker.map((r) => (r === R.use ? R.next : r))] },
        secrets: ["A_SECRET_WITH_A_LONG_NAME_FOR_THE_STAGING_PAYMENT_PROVIDER_TOKEN", "SENTRY_DSN"],
      },
      ...f.projects,
    ],
  };
}

function many(): SettingsData {
  const projects: ProjectSettings[] = Array.from({ length: 200 }, (_, i) => ({
    name: `project-${i + 1}`,
    repo: `/home/me/code/project-${i + 1}`,
    check: i % 2 ? "make check" : "bun run check",
    models: MODELS,
    reasons: REASONS,
    secrets: i % 3 ? [] : ["API_TOKEN"],
  }));
  return { projects };
}

export function settingsSample(state: PageState): SettingsData {
  if (state === "long") return long();
  if (state === "many") return many();
  return filled();
}

const model = (account: string, n: number) => `${account}/model-${n}`;
const FOUND = {
  harnesses: [
    {
      name: "pi",
      accounts: [
        { account: "anthropic", models: ["vendor-a/model-top", "vendor-a/model-mid"] },
        { account: "vendor-b", models: ["vendor-b/model-review", "vendor-b/model-lite"] },
      ],
    },
  ],
  chosen: { worker: "vendor-a/model-mid" },
};

/** The first-run view in each state: one role chosen in the filled one, a model name too long for a line, and 200 models. */
export function setupSample(state: PageState): SetupView {
  if (state === "empty") return { harnesses: [], chosen: {} };
  if (state === "long")
    return {
      harnesses: [
        {
          name: "pi",
          accounts: [
            { account: "openrouter", models: ["openrouter/some-provider/a-model-with-a-really-long-name-and-version-2026-10-01-preview"] },
            ...(FOUND.harnesses[0]?.accounts ?? []),
          ],
        },
      ],
      chosen: { worker: "openrouter/some-provider/a-model-with-a-really-long-name-and-version-2026-10-01-preview" },
    };
  if (state === "many")
    return {
      harnesses: [{ name: "pi", accounts: [{ account: "openrouter", models: Array.from({ length: 200 }, (_, i) => model("openrouter", i + 1)) }] }],
      chosen: {},
    };
  return FOUND;
}
