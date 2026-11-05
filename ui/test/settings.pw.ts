// The UI bar on Settings (`/settings`), served by `lineclear run`. The pictures use the sample states (`?state=`);
// the rest reads the machines and the project the fixture writes, each machine reached over ui/test/fake-ssh.
import { expect, type Page, test } from "@playwright/test";
import { MOTIONS, type Motion } from "../kit/motion.ts";
import { clickMidMotion, liveMotionTests, type Mid, press, reread, running, shotEveryState } from "./bar.ts";
import { shopSettings, sshLog, startSettings } from "./fixture.ts";

const order = (role: string) => `[...document.querySelectorAll('[data-models="${role}"] > li')].map((li) => li.dataset.model).join(" ")`;

/** Opens one of Settings' four sections: a tap on its row on a phone, on its name at the left on a desktop. */
async function openSection(page: Page, name: string) {
  await page.locator(`[data-section="${name}"]`).click();
  await expect(page.locator(`[data-section-panel="${name}"]`)).toBeVisible();
}

async function openMachines(page: Page) {
  await openSection(page, "Machines to add");
}

async function fresh(page: Page) {
  startSettings();
  await page.goto("/settings");
  await page.evaluate(() => document.fonts.ready);
  await openMachines(page);
  await page.waitForSelector('[data-machines] > [data-key="build-box"]');
  await page.waitForTimeout(300);
}

async function openWorkers(page: Page) {
  await openSection(page, "Models");
  await page.waitForSelector('[data-models="worker"]');
  await page.waitForTimeout(300);
}

test("Settings in every state, at this width", async ({ page }) => {
  await shotEveryState(page, "/settings", "settings");
});

test("Settings has four sections and no status: sections at the left on a desktop, 52 px rows on a phone", async ({ page }) => {
  await page.goto("/settings?state=filled");
  await expect(page.locator("[data-section]")).toHaveCount(4);
  const names = await page.locator("[data-section]").allTextContents();
  expect(names).toEqual(["Models", "Projects", "Machines to add", "Secrets"]);
  const narrow = (page.viewportSize()?.width ?? 1440) < 500;
  const nav = await page.locator('[data-section="Models"]').boundingBox();
  const panel = await page.locator("[data-section-panel]").boundingBox();
  if (narrow) {
    for (const x of await page.locator("[data-section]").all()) expect((await x.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(52);
    await expect(page.locator("[data-section-panel]")).toBeHidden();
    await openSection(page, "Secrets");
    await expect(page.locator("[data-section]").first()).toBeHidden();
    await page.getByRole("button", { name: "Back to the sections" }).click();
    await expect(page.locator("[data-section]").first()).toBeVisible();
  } else {
    expect(panel?.x ?? 0).toBeGreaterThan((nav?.x ?? 0) + (nav?.width ?? 0));
    await openSection(page, "Secrets");
    await expect(page.locator('[data-secrets-of="web-shop"]')).toContainText("PAYMENT_TEST_KEY");
  }
  await page.goto("/settings?state=filled");
  await openSection(page, "Models");
  for (const role of ["worker", "reviewer", "planner"]) await expect(page.locator(`[data-models="${role}"]`)).toBeVisible();
  await expect(page.locator("[data-machine], [role=meter]")).toHaveCount(0);
});

test("each model says why it is in use or not, and its arrows are 44 px to touch at 390 px", async ({ page }) => {
  await page.goto("/settings?state=filled");
  await openSection(page, "Models");
  const rows = page.locator('[data-models="worker"] > li');
  await expect(rows.nth(0).locator("[data-reason]")).toHaveText("account full until 16:00");
  await expect(rows.nth(1).locator("[data-reason]")).toHaveText("in use");
  await expect(rows.nth(2).locator("[data-reason]")).toHaveText("next, takes over when the ones above are full");
  // moving the full one down makes the next row the one in use, before the server answers
  await page.locator('[data-down="vendor-a/model-mid"]').click();
  await expect(rows.nth(0).locator("[data-reason]")).toHaveText("in use");
  const box = await page.locator('[data-models="worker"] [data-up="vendor-c/model-pro"]').boundingBox();
  const narrow = (page.viewportSize()?.width ?? 1440) < 500;
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(narrow ? 44 : 32);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(narrow ? 44 : 32);
});

test.describe("live", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "the live settings are checked once, at 1440 px");

  test("each machine is a row with its host, this one first, and no state or load", async ({ page }) => {
    await fresh(page);
    const rows = page.locator("[data-machines] > [data-key]");
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText("this machine");
    await expect(page.locator("[data-machine], [role=meter]")).toHaveCount(0);
  });

  test("Add machine installs it over SSH with install.sh and Remove forgets it", async ({ page }) => {
    await fresh(page);
    await page.getByTestId("open-add-machine").click();
    await page.getByRole("textbox", { name: /SSH host/ }).fill("me@fresh-box");
    await page.getByTestId("add-machine").click();
    const row = page.locator('[data-machine-row="me@fresh-box"]');
    await expect(row).toBeVisible();
    await expect.poll(sshLog, { timeout: 15_000 }).toMatch(/me@fresh-box env LINECLEAR_FOLLOWS='[^']*' sh -s < #!\/bin\/sh/);
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(row).toHaveCount(0);
    await reread(page);
    await page.waitForTimeout(500);
    await expect(row).toHaveCount(0);
  });

  test("a host that is not one is refused", async ({ page }) => {
    await fresh(page);
    await page.getByTestId("open-add-machine").click();
    await page.getByRole("textbox", { name: /SSH host/ }).fill("-oProxyCommand=x");
    await page.getByTestId("add-machine").click();
    await expect(page.getByRole("status").first()).toContainText("Give an SSH host");
    expect(sshLog()).not.toContain("ProxyCommand");
  });
});

test.describe("live 2", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "the live settings are checked once, at 1440 px");

  test("a model moves up with one click and its new order is saved", async ({ page }) => {
    await fresh(page);
    await openWorkers(page);
    expect(await page.evaluate(order("worker"))).toBe("vendor-a/model-mid vendor-b/model-code");
    await page.locator('[data-up="vendor-b/model-code"]').click();
    expect(await page.evaluate(order("worker"))).toBe("vendor-b/model-code vendor-a/model-mid");
    await expect.poll(() => shopSettings().models.worker.join(" ")).toBe("vendor-b/model-code vendor-a/model-mid");
    expect(shopSettings().models.reviewer).toEqual(["vendor-b/model-code"]);
    // the row that is number 1 says it is in use
    await expect(page.locator('[data-models="worker"] > li').first().locator("[data-reason]")).toHaveText(/^in use/);
  });

  test("an account is one compact row, saved when the price is left; Retired marks it", async ({ page }) => {
    await page.goto("/settings?state=filled");
    const row = page.locator('[data-account="anthropic"]');
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Save" })).toHaveCount(0);
    await expect(row.getByLabel("Price of anthropic a month")).toHaveValue("100");
    await row.getByTestId("retire-anthropic").check();
    await expect(row.getByTestId("retire-anthropic")).toBeChecked();
    await page.locator('[data-section="Projects"]').click();
    await expect(page.getByTestId("show-paused")).not.toBeChecked();
    await page.getByTestId("show-paused").check();
    await expect(page.getByTestId("show-paused")).toBeChecked();
  });

  test("a project's check command is changed and saved, and its secrets show by name only", async ({ page }) => {
    await fresh(page);
    await openSection(page, "Projects");
    const p = page.locator('[data-project-settings="web-shop"]');
    // the card says what the check runs; the command itself is behind Details
    await expect(p.locator("[data-check-summary]")).toBeVisible();
    await p.getByRole("button", { name: "Details" }).click();
    await p.getByRole("textbox", { name: "web-shop check command" }).fill("make check");
    await p.getByRole("button", { name: "Save" }).click();
    await expect(p.getByRole("status")).toContainText("Saved");
    expect(shopSettings().check).toBe("make check");
    await expect(p.locator("[data-check-summary]")).toHaveText("make check");
    await expect(p.locator("[data-secrets]")).toContainText("No secrets");
  });

  test("nothing moves at rest, while the view reads the server", async ({ page }) => {
    await fresh(page);
    await page.waitForTimeout(3500);
    expect(await running(page)).toEqual([]);
  });
});

test.describe("live 3", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "the live settings are checked once, at 1440 px");

  const worker = `${order("worker")} === "vendor-b/model-code vendor-a/model-mid"`;
  const down = '[data-down="vendor-a/model-mid"]';
  type Live = { after: string; open?: (page: Page) => Promise<void>; act: (page: Page) => Promise<unknown>; click: (page: Page, m: Motion) => Promise<Mid> };
  const moves: [Motion, Live][] = [
    [
      "model-move",
      {
        after: worker,
        open: openWorkers,
        act: (page) => press(page, down),
        click: (page, m) =>
          clickMidMotion(page, down, '[data-up="vendor-a/model-mid"]', `${order("worker")} === "vendor-a/model-mid vendor-b/model-code"`, MOTIONS[m].ms / 2),
      },
    ],
  ];

  liveMotionTests({
    moves,
    fresh: async (page, live) => {
      await fresh(page);
      await live.open?.(page);
    },
    act: (page, live) => live.act(page),
    click: (page, m, live) => live.click(page, m),
  });
});
