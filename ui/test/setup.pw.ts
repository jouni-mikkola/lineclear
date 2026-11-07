// The UI bar on the first-run setup (`/setup`) and on the same choice in Settings, served by `lineclear run`. The
// pictures use the sample states (`?state=`); the rest reads the models ui/test/fake-pi lists.
import { expect, type Page, test } from "@playwright/test";
import { shotEveryState } from "./bar.ts";
import { startSetup } from "./fixture.ts";

const MODELS = ["anthropic claude-opus-4", "anthropic claude-sonnet-4", "openai-codex gpt-6.1-sol", "openrouter kimi-k2"];
const pick = (page: Page, role: string, model: string) => page.locator(`[data-role-pick="${role}"]`).selectOption(model);

test("The first-run view in every state, at this width", async ({ page }) => {
  await shotEveryState(page, "/setup", "setup");
});

test("200 models and a long model name stay inside the page", async ({ page }) => {
  for (const state of ["many", "long"]) {
    await page.goto(`/setup?state=${state}`);
    await expect(page.locator("[data-setup]")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto("/setup?state=many");
  await expect(page.locator('[data-role-pick="worker"] option')).toHaveCount(201);
});

test("nothing found says so and offers no choice", async ({ page }) => {
  await page.goto("/setup?state=empty");
  await expect(page.getByText("No harness is logged in.")).toBeVisible();
  await expect(page.locator("[data-role-pick]")).toHaveCount(0);
});

test("a failed read says why and can be tried again", async ({ page }) => {
  await page.route("**/api/setup", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"The harnesses did not answer."}' }),
  );
  await page.goto("/setup");
  await expect(page.getByText("The harnesses did not answer.")).toBeVisible();
});

test("the first run lists what is found, preselects nothing, saves, and Settings edits it", async ({ page }) => {
  startSetup(MODELS);
  await page.goto("/setup");
  await expect(page.locator('[data-harness="pi"]')).toContainText("anthropic (2 models), openai-codex (1 model)");
  for (const role of ["worker", "reviewer", "planner", "stepChecker"]) await expect(page.locator(`[data-role-pick="${role}"]`)).toHaveValue("");

  await pick(page, "worker", "anthropic/claude-sonnet-4");
  await pick(page, "reviewer", "anthropic/claude-opus-4");
  await page.getByTestId("save-setup").click();
  await expect(page.locator("[data-setup-status]")).toContainText("worker's company");

  await pick(page, "reviewer", "openai-codex/gpt-6.1-sol");
  await pick(page, "planner", "anthropic/claude-opus-4");
  await pick(page, "stepChecker", "openrouter/kimi-k2");
  await page.getByTestId("save-setup").click();
  await expect(page.locator("[data-setup-status]")).toHaveText("Saved.");

  await page.goto("/setup");
  await expect(page.locator('[data-role-pick="reviewer"]')).toHaveValue("openai-codex/gpt-6.1-sol");
  await expect(page.locator('[data-role-pick="stepChecker"]')).toHaveValue("openrouter/kimi-k2");

  // Settings shows the same choice, and a change there reads back
  await page.goto("/settings");
  await page.locator('[data-section="Models"]').click();
  await expect(page.locator('[data-setup-choice] [data-role-pick="worker"]')).toHaveValue("anthropic/claude-sonnet-4");
  await pick(page, "planner", "anthropic/claude-sonnet-4");
  await page.getByTestId("save-setup").click();
  await expect(page.locator("[data-setup-status]")).toHaveText("Saved.");
  await page.goto("/setup");
  await expect(page.locator('[data-role-pick="planner"]')).toHaveValue("anthropic/claude-sonnet-4");
});
