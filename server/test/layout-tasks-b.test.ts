import { browser, world, server, url, headings } from './layout-tasks-fixture.ts'
import { describe, expect, test } from 'bun:test'
import type { Page } from 'playwright-core'
import { waiting } from '../shared/alerts.ts'
import { hold, settled } from './layout.ts'

describe.skipIf(!browser)('a change moves only its own row', () => {
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 640 }],
    ['desktop', { width: 1440, height: 640 }],
  ] as const)
    test(`a status change keeps the other rows' nodes and what shows stays put; with reduced motion nothing glides (${name})`, async () => {
      const busy = world.tasks.find((t) => t.id === 'HP-202')!
      const extra = Array.from({ length: 12 }, (_, i) => ({ ...busy, id: `HP-W${i}`, name: `Busy job ${i}` }))
      world.tasks.push(...extra)
      const merging = world.tasks.find((t) => t.id === 'GTM-18')!
      const was = { ...merging }
      try {
        const page = await browser!.newPage({ viewport, hasTouch: name === 'phone' })
        await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home&tab=tasks`)
        await page.locator('li[data-flip="HP-W11"]').waitFor()
        // scrolled so Merging and the first busy rows are above what shows: its one task is merged, so that group goes
        const before = await page.evaluate(() => {
          const rows = [...document.querySelectorAll<HTMLElement>('li[data-flip]')]
          let box = rows[0].parentElement!
          while (!/auto|scroll/.test(getComputedStyle(box).overflowY)) box = box.parentElement!
          box.scrollTop = rows.find((r) => r.dataset.flip === 'HP-W3')!.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
          const w = window as unknown as { rows: Map<string, HTMLElement>; box: HTMLElement }
          w.rows = new Map(rows.map((r) => [r.dataset.flip!, r]))
          w.box = box
          const view = box.getBoundingClientRect()
          const seen = rows
            .filter((r) => r.getBoundingClientRect().top >= view.top && r.getBoundingClientRect().bottom <= view.bottom)
            .map((r) => [r.dataset.flip!, r.getBoundingClientRect().top] as const)
          return { scrolled: box.scrollTop, seen }
        })
        expect(before.scrolled).toBeGreaterThan(0)
        expect(before.seen.length).toBeGreaterThan(3)
        await world.act({ type: 'close', chat: 'GTM-18/Agent', force: true })
        await page.waitForFunction(
          () => document.querySelector('li[data-flip="GTM-18"]') !== (window as unknown as { rows: Map<string, HTMLElement> }).rows.get('GTM-18'),
        )
        await settled(page)
        const after = await page.evaluate((seen) => {
          const w = window as unknown as { rows: Map<string, HTMLElement>; box: HTMLElement }
          const swapped = [...w.rows]
            .filter(([k, r]) => k !== 'GTM-18' && (!r.isConnected || document.querySelector(`li[data-flip="${k}"]`) !== r))
            .map(([k]) => k)
          const moved = seen.filter(([k, y]) => k !== 'GTM-18' && Math.abs(w.rows.get(k)!.getBoundingClientRect().top - y) > 1).map(([k]) => k)
          return { swapped, moved, ghosts: w.box.querySelectorAll('[aria-hidden="true"][inert]').length }
        }, before.seen)
        // every other row is the very same node, and what showed is where it showed: the list scrolled to keep it there
        expect(after).toEqual({ swapped: [], moved: [], ghosts: 0 })
        // with reduced motion a change lands at once: nothing glides or fades
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await world.act({ type: 'pause', chat: 'HP-W5/Agent' })
        await page.waitForFunction(
          () => document.querySelector('li[data-flip="HP-W5"]') !== (window as unknown as { rows: Map<string, HTMLElement> }).rows.get('HP-W5'),
        )
        expect(await page.evaluate(() => document.getAnimations().filter((a) => a.id.startsWith('flip')).length)).toBe(0)
        await page.close()
      } finally {
        world.tasks.splice(world.tasks.indexOf(extra[0]), extra.length)
        Object.assign(merging, was)
      }
    })
})

describe.skipIf(!browser)('To do always shows; Automations only once there is one', () => {
  test('empty, To do says so calmly; Automations and the other groups stay hidden (desktop light and dark, tablet, phone)', async () => {
    for (const colorScheme of ['light', 'dark'] as const) {
      const ctx = await browser!.newContext({ viewport: { width: 1440, height: 800 }, colorScheme })
      const page = await ctx.newPage()
      await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:mac:lilla-varlden')}`)
      const tasks = page.locator('section[aria-label="Tasks"]')
      await tasks.locator('li').first().waitFor()
      expect(await headings(page)).toEqual(['Needs you', 'To do'])
      await expect(tasks.getByText('No tasks to do yet. Ask a coordinator to add one.', { exact: true }).isVisible()).resolves.toBe(true)
      expect(await tasks.getByText(/automations/i).count()).toBe(0)
      await ctx.close()
    }
    // a tablet, the same
    const tablet = await browser!.newPage({ viewport: { width: 900, height: 800 } })
    await tablet.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:mac:lilla-varlden')}`)
    await tablet.getByText('No tasks to do yet. Ask a coordinator to add one.', { exact: true }).waitFor()
    expect(
      await tablet
        .locator('section[aria-label="Tasks"]')
        .getByText(/automations/i)
        .count(),
    ).toBe(0)
    await tablet.close()
    // and on a phone's Tasks tab
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'light' })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:mac:lilla-varlden')}&tab=tasks`)
    await page.getByText('No tasks to do yet. Ask a coordinator to add one.', { exact: true }).waitFor()
    expect(await page.getByText(/automations/i).count()).toBe(0)
    await ctx.close()
  })

  test('a place with automations shows the heading, under To do (desktop, tablet, phone)', async () => {
    for (const viewport of [
      { width: 1440, height: 800 },
      { width: 900, height: 800 },
    ]) {
      const page = await browser!.newPage({ viewport })
      await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}`)
      const tasks = page.locator('section[aria-label="Tasks"]')
      await tasks.locator('li[aria-expanded]', { hasText: 'Flaky tests' }).waitFor()
      const labels = await tasks.locator('[data-heading]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.heading))
      expect(labels.indexOf('Automations')).toBeGreaterThan(labels.indexOf('To do'))
      expect(labels.indexOf('To do')).toBeGreaterThan(-1)
      await page.close()
    }
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}&tab=tasks`)
    await page.locator('li[aria-expanded]', { hasText: 'Flaky tests' }).waitFor()
    await expect(page.getByText('Automations', { exact: true }).isVisible()).resolves.toBe(true)
    await ctx.close()
  })
})

describe.skipIf(!browser)('To do always shows; Automations only once there is one, continued', () => {
  test("everything (no chips) shows every space's automations, each under its space's name; one space's keep their plain heading (desktop, phone)", async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home`)
    const tasks = page.locator('section[aria-label="Tasks"]')
    await tasks.locator('li[aria-expanded]', { hasText: 'Flaky tests' }).waitFor()
    const heading = tasks.locator('[data-heading="Automations"]')
    expect(await heading.allInnerTexts()).toEqual([expect.stringMatching(/^Automations · gtm/)])
    expect(await tasks.locator('li[aria-expanded]').count()).toBe(3)
    // one space's own list: the heading as it was, no name
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}`)
    await tasks.locator('li[aria-expanded]', { hasText: 'Flaky tests' }).waitFor()
    expect(await heading.innerText()).not.toContain('·')
    await page.close()
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const phone = await ctx.newPage()
    await phone.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home&tab=tasks`)
    await phone.locator('li[aria-expanded]', { hasText: 'Flaky tests' }).waitFor()
    const label = phone.locator('[data-heading="Automations"]')
    await expect(label.isVisible()).resolves.toBe(true)
    expect(await label.innerText()).toMatch(/^Automations · gtm/)
    expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await ctx.close()
  })

  test('an automation summarizes its trigger and shows its task only when expanded; a tap shows it in full with its next and last runs; run now, pause and remove, no adding or editing (phone)', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}&tab=tasks`)
    const row = page.locator('li[aria-expanded]', { hasText: 'Flaky tests' })
    await row.waitFor()
    // its trigger in words, in the time zone of Settings
    expect(await row.innerText()).toBe('Flaky tests\nEvery day at 7:00 (Stockholm)')
    expect(await page.locator('li[aria-expanded]', { hasText: 'Dependency bump' }).innerText()).toBe(
      'Dependency bump\nPaused · The last Friday of the month at 8:00 (Stockholm)',
    )
    const event = page.locator('li[aria-expanded]', { hasText: 'Changelog' })
    expect(await event.innerText()).toBe('Changelog\nWhen a task is merged')
    await event.tap()
    const eventDetail = page.locator(`#${await event.getAttribute('aria-controls')}`)
    expect(await eventDetail.locator('dt').allInnerTexts()).toEqual(['When', 'Task', 'Last runs'])
    expect(await eventDetail.locator('dd').nth(1).innerText()).toBe('Update the changelog')
    expect(await event.innerText()).toBe('Changelog\nWhen a task is merged')
    await event.tap()
    expect(await row.getAttribute('aria-expanded')).toBe('false')
    await row.tap()
    expect(await row.getAttribute('aria-expanded')).toBe('true')
    const detail = page.locator(`#${await row.getAttribute('aria-controls')}`)
    expect(await detail.locator('dt').allInnerTexts()).toEqual(['When', 'Next', 'Task', 'Brief', 'Last runs'])
    // its next three runs
    expect((await detail.locator('dd').nth(1).innerText()).split(' · ')).toHaveLength(3)
    expect(await detail.locator('dd').nth(1).innerText()).toMatch(/7:00$/)
    expect(await detail.locator('dd').nth(2).innerText()).toBe('Rerun the flaky test suite')
    expect(await detail.locator('dd').nth(4).innerText()).toContain('GTM-41')
    // nothing spills sideways
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await detail.getByRole('button', { name: 'Run now' }).tap()
    await detail.getByText('GTM-51').waitFor()
    await detail.getByRole('button', { name: 'Pause' }).tap()
    await row.getByText('Paused · Every day at 7:00').waitFor()
    expect(await detail.locator('dt').allInnerTexts()).not.toContain('Next')
    await detail.getByRole('button', { name: 'Resume' }).tap()
    await detail.getByRole('button', { name: 'Pause' }).waitFor()
    // only agents add or change one, when asked in the chat: no Edit, no New automation
    expect(await detail.getByRole('button').allInnerTexts()).toEqual(['GTM-51', 'GTM-41', 'Run now', 'Pause', 'Remove'])
    expect(await page.getByText('New automation').count()).toBe(0)
    await detail.getByRole('button', { name: 'Remove' }).tap()
    await row.waitFor({ state: 'detached' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await ctx.close()
  })
})

describe.skipIf(!browser)('archiving a task', () => {
  test("a row's ⋯ archives it: it leaves the list and the count, and Archived at the bottom brings it back", async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}`)
    const tasks = page.locator('section[aria-label="Tasks"]')
    const row = tasks.locator('li', { hasText: 'GTM-17' })
    await row.waitFor()
    // the ⋯ is tucked away until the pointer is on the row
    const more = row.getByRole('button', { name: 'More for this task' })
    expect(await more.evaluate((b) => getComputedStyle(b).opacity)).toBe('0')
    await row.hover()
    expect(await more.evaluate((b) => getComputedStyle(b).opacity)).toBe('1')
    await more.click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await row.waitFor({ state: 'detached' })
    const link = tasks.getByRole('button', { name: /^Archived\s*3$/ })
    await link.waitFor()
    await link.click()
    // the Archived view: the latest archived first, each with its ⋯
    await tasks.getByText('Archived', { exact: true }).first().waitFor()
    const ids = await tasks.locator('li').evaluateAll((li) => li.map((l) => l.textContent?.match(/^[A-Z]+-[A-Z0-9]+/)?.[0]))
    expect(ids).toEqual(['GTM-17', 'GTM-11', 'GTM-9'])
    const back = tasks.locator('li', { hasText: 'GTM-17' })
    await back.hover()
    await back.getByRole('button', { name: 'More for this task' }).click()
    await page.getByRole('menuitem', { name: 'Unarchive' }).click()
    await back.waitFor({ state: 'detached' })
    // Esc leaves the Archived view; the task is in its list again
    await page.locator('body').click({ position: { x: 600, y: 500 } })
    await page.keyboard.press('Escape')
    await tasks.locator('li', { hasText: 'GTM-17' }).waitFor()
    await page.close()
  })

  test('archiving a working task asks first: its agent stops; ⌘K still finds it', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:herdr-projects')}`)
    const row = page.locator('section[aria-label="Tasks"] li', { hasText: 'Voice call drops on mute' })
    await row.hover()
    await row.getByRole('button', { name: 'More for this task' }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    const ask = page.getByRole('alertdialog', { name: 'Archive HP-202?' })
    await ask.waitFor()
    await page.keyboard.press('Escape')
    await ask.waitFor({ state: 'detached' })
    expect(await row.count()).toBe(1)
    await row.hover()
    await row.getByRole('button', { name: 'More for this task' }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await ask.getByRole('button', { name: 'Stop and archive' }).click()
    await row.waitFor({ state: 'detached' })
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: 'Search or jump to' }).or(page.getByLabel('Search or jump to').locator('input')).first().fill('HP-202')
    const hit = page.getByRole('group', { name: 'Tasks', exact: true }).getByRole('option').filter({ hasText: 'Voice call drops on mute' })
    await hit.waitFor()
    expect(await hit.textContent()).toContain('Archived')
    await hit.click()
    expect(page.url()).toContain('task=HP-202')
    await world.act({ type: 'archive', chat: 'HP-202/Agent', on: false })
    await page.close()
  })

  test('a phone: holding a row opens its menu, with no ⋯ in the way', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}&tab=tasks`)
    const row = page.locator('li', { hasText: 'GTM-17' })
    await row.waitFor()
    expect(await row.getByRole('button', { name: 'More for this task' }).isVisible()).toBe(false)
    await hold(page, row)
    await page.getByRole('menuitem', { name: 'Archive' }).waitFor()
    // the hold didn't open the task
    expect(page.url()).not.toContain('task=')
    const menu = (await page.getByRole('menu').boundingBox())!
    expect(menu.x).toBeGreaterThanOrEqual(0)
    expect(menu.x + menu.width).toBeLessThanOrEqual(390)
    await ctx.close()
  })
})

describe.skipIf(!browser)("an alert's link", () => {
  /** a page that remembers what was lit up last (data-lit): the light lasts a moment, and a slow machine may still be
   *  scrolling there when it goes */
  const open = async (viewport = { width: 390, height: 844 }) => {
    const page = await browser!.newPage({ viewport })
    await page.addInitScript(() =>
      new MutationObserver((ms) => {
        for (const m of ms) {
          const el = m.target as Element
          if (!el.hasAttribute('data-flash')) continue
          for (const was of document.querySelectorAll('[data-lit]')) was.removeAttribute('data-lit')
          el.setAttribute('data-lit', '')
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-flash'] }),
    )
    return page
  }
  const flashed = (page: Page) =>
    page.waitForFunction(() => {
      const f = document.querySelector('[data-lit]')
      const b = f?.getBoundingClientRect()
      // once it has scrolled there
      if (!f || !b || b.top < 0 || b.top > innerHeight - 100) return null
      return { card: f.hasAttribute('data-card'), msg: f.closest('[data-whole]')?.getAttribute('data-whole'), inView: true }
    })
  test("opened cold, it shows the task's card in view, lit up, its buttons ready; the address forgets the card", async () => {
    const t = world.snapshot().tasks.find((x) => x.id === 'GTM-16')!
    const plan = world.chat('GTM-16/Agent').messages.find((m) => m.question?.kind === 'Plan')!
    const page = await open()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(t.place)}&task=GTM-16&focus=${encodeURIComponent(plan.question!.id)}`)
    const f = await (await flashed(page)).jsonValue()
    expect(f).toEqual({ card: true, msg: plan.id, inView: true })
    expect(await page.locator('[data-lit]').getByRole('button', { name: 'Send', exact: true }).isVisible()).toBe(true)
    expect(new URL(page.url()).searchParams.has('focus')).toBe(false)
    expect(new URL(page.url()).searchParams.get('task')).toBe('GTM-16')
    await page.close()
  })

  test("a coordinator's question and a done task's card, in the space's chat", async () => {
    const place = 'p:vm-str:gtm'
    const ask = world.chat(place).messages.find((m) => m.question && m.question.sent === undefined)!
    const done = world.chat(place).messages.find((m) => m.card?.task === 'GTM-12')!
    const page = await open()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(place)}&focus=${encodeURIComponent(ask.question!.id)}`)
    expect(await (await flashed(page)).jsonValue()).toEqual({ card: true, msg: ask.id, inView: true })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(place)}&focus=${encodeURIComponent(done.id)}`)
    expect(await (await flashed(page)).jsonValue()).toMatchObject({ msg: done.id, inView: true })
    await page.close()
  })

  test('a message far up the chat comes into view', async () => {
    const page = await open()
    // as slow as a phone, still drawing the chat while it glides up (it used to pull the chat back down)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home&focus=code-agent`)
    const f = await (await flashed(page)).jsonValue()
    expect(f).toMatchObject({ card: false, msg: 'code-agent', inView: true })
    await page.close()
  })

  test('a tap on an alert with the app open goes to the card without reloading', async () => {
    const page = await open()
    await page.goto(url())
    await page.waitForSelector('[data-msg="short-agent"]')
    await page.evaluate(() => ((window as unknown as { kept: number }).kept = 1))
    const t = world.snapshot().tasks.find((x) => x.id === 'HP-201')!
    const q = world.chat('HP-201/Agent').messages.find((m) => m.question)!
    await page.evaluate(
      (u) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open', url: u } })),
      `./?place=${encodeURIComponent(t.place)}&task=HP-201&focus=${encodeURIComponent(q.question!.id)}`,
    )
    const f = await (await flashed(page)).jsonValue()
    expect(f).toMatchObject({ card: true, inView: true })
    expect(new URL(page.url()).searchParams.get('task')).toBe('HP-201')
    expect(await page.evaluate(() => (window as unknown as { kept?: number }).kept)).toBe(1)
    await page.close()
  })

  test('the window title counts what waits on you, as the app icon does', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 844 } })
    await page.goto(url())
    const n = waiting(world.snapshot()).count
    expect(n).toBeGreaterThan(0)
    await page.waitForFunction((t) => document.title === t, `(${n}) Shepherdr`)
    await page.close()
  })

  test('the app icon gets the same count, where the device has one', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    await page.addInitScript(() => {
      const w = window as unknown as { badges: unknown[] }
      w.badges = []
      Object.assign(navigator, { setAppBadge: async (n: number) => void w.badges.push(n), clearAppBadge: async () => void w.badges.push('clear') })
    })
    await page.goto(url())
    const n = waiting(world.snapshot()).count
    await page.waitForFunction((n) => (window as unknown as { badges: unknown[] }).badges.at(-1) === n, n)
    await page.close()
  })
})
