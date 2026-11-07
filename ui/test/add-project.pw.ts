// The UI bar on the first day on Home: the card in its states at this width, and on an empty config one project
// started from the page, which `lineclear project list` then shows.
import { expect, test } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE, fixtureEnv, NEW_REPO, startEmpty } from "./fixture.ts";

test("the first-day card offers the home's repos and shows what it found in one, at this width", async ({ page }) => {
  await page.goto("/?state=empty");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("[data-repos]")).toBeVisible();
  await page.getByTestId("repo-web-shop").click();
  await expect(page.locator("[data-detected]")).toBeVisible();
  await expect(page).toHaveScreenshot("home-add-found.png", { fullPage: true });
});

test("the add form names a folder that does not exist, at this width", async ({ page }) => {
  startEmpty();
  await page.waitForTimeout(1100);
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("textbox", { name: /folder of a(nother)? repo/ }).fill("/nowhere/new-shop");
  await page.getByTestId("look-project").click();
  await expect(page.locator("[data-add-project]").getByRole("status")).toContainText("There is no folder");
  await expect(page.locator("[data-add-project]")).toHaveScreenshot("home-add-missing.png", {
    // the folder's path holds the run's temp folder, which differs on every run
    mask: [page.getByRole("textbox", { name: /folder of a repo/ }), page.locator("[data-add-project]").getByRole("status")],
  });
});

test.describe("live", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "the live add is checked once, at 1440 px");

  test("on an empty config a project is added from Home, and the CLI lists it", async ({ page }) => {
    startEmpty();
    await page.waitForTimeout(1100);
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('[data-part="First project"]')).toBeVisible();
    await page.getByRole("textbox", { name: /folder of a(nother)? repo/ }).fill(NEW_REPO);
    await page.getByTestId("look-project").click();
    // what Lineclear finds: the check from package.json and the roadmap; the space comes from the board
    await expect(page.getByLabel("Check command", { exact: true })).toHaveValue("bun run check");
    await expect(page.locator("[data-roadmap-found]")).toHaveAttribute("data-roadmap-found", "true");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("new-shop");
    // pi offers no model in this fixture, so the card opens its fields and asks for one
    await page.getByLabel("Models, best first", { exact: true }).fill("vendor-a/model-mid, vendor-b/model-code");
    await page.getByTestId("save-project").click();
    await expect(page.locator("[data-add-project]").getByRole("status")).toContainText("Started new-shop.");
    const list = execFileSync("bin/lineclear", ["project", "list"], {
      env: fixtureEnv({ LINECLEAR_HOME: `${FIXTURE}/home` }),
    }).toString();
    expect(list).toContain("new-shop");
    expect(list).toContain(`space new-shop`);
    expect(list).toContain("check     bun run check");
    expect(list).toContain("worker    vendor-a/model-mid, vendor-b/model-code");
  });

  test("Home shows a problem the doctor finds with its fix command", async ({ page }) => {
    startEmpty();
    // this one asks the real doctor
    rmSync(join(FIXTURE, "doctor.json"), { force: true });
    await page.waitForTimeout(1100);
    await page.goto("/");
    const fixes = page.locator("[data-doctor] li");
    // the fix commands sit behind Details
    await page.locator("[data-doctor]").getByRole("button", { name: "Details" }).click({ timeout: 15_000 });
    // the page asks again every 1.5 s: the first answer comes before the doctor has looked
    await expect(fixes.first()).toBeVisible({ timeout: 15_000 });
    const shown = await fixes.first().innerText();
    // the doctor exits 1 when it finds a problem, so its output is read from the run either way
    const run = spawnSync("bin/lineclear", ["doctor", "--here"], {
      env: fixtureEnv({ LINECLEAR_HOME: `${FIXTURE}/home` }),
    });
    const fixLines = run.stdout
      .toString()
      .split("\n")
      .filter((l) => /^\s+fix: /.test(l))
      .map((l) => l.replace(/^\s+fix: /, ""));
    expect(fixLines.some((f) => shown.endsWith(`: ${f}`))).toBe(true);
  });

  test("a project without a check command is refused with the reason", async ({ page }) => {
    startEmpty();
    await page.waitForTimeout(1100);
    await page.goto("/");
    await page.getByRole("textbox", { name: /folder of a(nother)? repo/ }).fill(NEW_REPO);
    await page.getByTestId("look-project").click();
    await page.getByLabel("Models, best first", { exact: true }).fill("vendor-a/model-mid");
    await page.getByLabel("Check command", { exact: true }).fill("");
    await page.getByTestId("save-project").click();
    await expect(page.locator("[data-add-project]").getByRole("status")).toContainText("Lineclear found no tests in this repo.");
  });
});
