import { browser, world, server, url } from './layout-places-fixture.ts'
import { describe, expect, test } from 'bun:test'
import { settled } from './layout.ts'

describe.skipIf(!browser)('sidebars', () => {
  const width = (page: import('playwright-core').Page, sel: string) => page.$eval(sel, (el) => Math.round(el.getBoundingClientRect().width))
  const places = '#places'
  const tasks = 'section[aria-label="Tasks"]'
  /** drags a separator's middle by dx */
  const drag = async (page: import('playwright-core').Page, name: string, dx: number) => {
    const b = (await page.getByRole('separator', { name }).boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 6 })
    await page.mouse.up()
  }
  const settled = (page: import('playwright-core').Page) => page.waitForTimeout(350)

  test('drag an inner edge to resize, double-click to reset; this device remembers (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await page.goto(url())
    await page.getByRole('separator', { name: 'Resize places' }).waitFor()
    expect(await width(page, places)).toBe(260)
    expect(await width(page, tasks)).toBe(400)
    await drag(page, 'Resize places', 80)
    await drag(page, 'Resize tasks', -100)
    expect(await width(page, places)).toBe(340)
    expect(await width(page, tasks)).toBe(500)
    // no wider than their max, and the chat keeps its room
    await drag(page, 'Resize places', 400)
    expect(await width(page, places)).toBe(400)
    // the arrow keys resize a focused edge
    await page.getByRole('separator', { name: 'Resize tasks' }).focus()
    await page.keyboard.press('ArrowLeft')
    await settled(page)
    expect(await width(page, tasks)).toBe(516)
    await page.reload()
    await page.getByRole('separator', { name: 'Resize places' }).waitFor()
    expect(await width(page, places)).toBe(400)
    expect(await width(page, tasks)).toBe(516)
    await page.getByRole('separator', { name: 'Resize places' }).dblclick()
    await page.getByRole('separator', { name: 'Resize tasks' }).dblclick()
    await settled(page)
    expect(await width(page, places)).toBe(260)
    expect(await width(page, tasks)).toBe(400)
    await page.close()
  })

  test('places hides with its toggle, ⌘B, or dragged narrow, and comes back as wide as it was (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await page.goto(url())
    const hide = page.getByRole('button', { name: 'Hide Places' })
    const show = page.getByRole('button', { name: 'Show Places' })
    await drag(page, 'Resize places', 60)
    expect(await width(page, places)).toBe(320)
    // the toggle at the top of places; hidden, the chat's header keeps the place's name and the toggle
    await hide.click()
    await settled(page)
    expect(await page.$eval(places, (n) => n.parentElement!.getBoundingClientRect().width)).toBe(0)
    expect(await page.$eval(places, (n) => n.parentElement!.inert)).toBe(true)
    expect(await page.getByRole('separator', { name: 'Resize places' }).count()).toBe(0)
    expect(await page.locator('section').first().getByText('home', { exact: true }).isVisible()).toBe(true)
    expect(await page.locator('section').first().getByText('Home · every machine', { exact: true }).isVisible()).toBe(true)
    expect(await show.getAttribute('aria-expanded')).toBe('false')
    // focus follows the toggle to its other spot
    expect(await show.evaluate((b) => b === document.activeElement)).toBe(true)
    await show.click()
    await settled(page)
    expect(await width(page, places)).toBe(320)
    // ⌘B (Ctrl+B) works while typing too
    await page.getByRole('textbox', { name: /Message/ }).focus()
    await page.keyboard.press('Control+b')
    await settled(page)
    expect(await show.isVisible()).toBe(true)
    await page.keyboard.press('Control+b')
    await settled(page)
    expect(await hide.isVisible()).toBe(true)
    // dragged narrow enough, it snaps shut; it stays shut after a reload
    await drag(page, 'Resize places', -200)
    await settled(page)
    expect(await show.isVisible()).toBe(true)
    await page.reload()
    await show.waitFor()
    expect(await page.$eval(places, (n) => n.parentElement!.getBoundingClientRect().width)).toBe(0)
    // the sidebar's foot holds Settings alone
    expect(await page.getByText('Keyboard', { exact: true }).count()).toBe(0)
    // and Settings' Keyboard shortcuts lists the key: ? opens it there and shuts it again
    await page.keyboard.press('?')
    const settings = page.getByRole('region', { name: 'Settings' })
    expect(await settings.getByRole('button', { name: 'Keyboard shortcuts' }).getAttribute('aria-current')).toBe('page')
    expect(await settings.getByText('Show or hide Places').count()).toBe(1)
    await page.keyboard.press('?')
    expect(await settings.count()).toBe(0)
    await show.click()
    await settled(page)
    expect(await width(page, places)).toBe(320)
    await page.close()
  })

  test('while dragging, the chat beside reflows with every move: nothing overlaps it, nothing jumps on letting go (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await page.goto(url())
    await page.getByRole('separator', { name: 'Resize places' }).waitFor()
    /** the chat's content (its right edge) against the columns either side of it */
    const edges = () =>
      page.evaluate(() => {
        const chat = document.querySelector('#places')!.parentElement!.nextElementSibling!.firstElementChild!.getBoundingClientRect()
        return {
          chatLeft: Math.round(chat.left),
          chatRight: Math.round(chat.right),
          places: Math.round(document.querySelector('#places')!.parentElement!.getBoundingClientRect().right),
          tasks: Math.round(document.querySelector('section[aria-label="Tasks"]')!.getBoundingClientRect().left),
        }
      })
    for (const [name, dx] of [
      ['Resize tasks', -300],
      ['Resize tasks', 60],
      ['Resize places', 120],
    ] as const) {
      const b = (await page.getByRole('separator', { name }).boundingBox())!
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 6 })
      // a frame later, still held: the chat fills just the room between, as it will after letting go
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      const held = await edges()
      expect(held.chatLeft).toBe(held.places)
      expect(held.chatRight).toBe(held.tasks)
      await page.mouse.up()
      expect(await edges()).toEqual(held)
    }
    await page.close()
  })

  test('available room chooses a drawer at 820/1024/1100 and docking at 1180; resized lists keep chat readable', async () => {
    const page = await browser!.newPage({ viewport: { width: 1024, height: 850 } })
    await page.goto(url())
    await page.getByRole('textbox', { name: 'Message home…' }).waitFor()
    for (const w of [820, 1024, 1100, 1180, 1440]) {
      await page.setViewportSize({ width: w, height: 850 })
      await settled(page)
      const docked = w >= 1180
      expect(await page.getByRole('button', { name: 'Hide Places', exact: true }).count()).toBe(docked ? 1 : 0)
      expect(await page.getByRole('button', { name: 'Places', exact: true }).count()).toBe(docked ? 0 : 1)
      expect(
        await page
          .locator('[data-messages]')
          .first()
          .evaluate((e) => e.getBoundingClientRect().width),
      ).toBeGreaterThanOrEqual(480)
      if (!docked) {
        await page.getByRole('button', { name: 'Places', exact: true }).click()
        await page.getByRole('navigation', { name: 'Places' }).waitFor()
        await page.getByRole('button', { name: 'Close', exact: true }).click()
      }
    }
    await drag(page, 'Resize tasks', -300)
    await page.setViewportSize({ width: 1180, height: 850 })
    await settled(page)
    expect(await page.getByRole('button', { name: 'Places', exact: true }).count()).toBe(1)
    expect(
      await page
        .locator('[data-messages]')
        .first()
        .evaluate((e) => e.getBoundingClientRect().width),
    ).toBeGreaterThanOrEqual(480)
    await page.reload()
    await page.getByRole('button', { name: 'Places', exact: true }).waitFor()
    await page.setViewportSize({ width: 1920, height: 850 })
    await page.getByRole('button', { name: 'Hide Places', exact: true }).waitFor()
    expect(await width(page, tasks)).toBe(700)
    // Explicitly hidden places and task tools stay hidden on wider windows.
    await page.getByRole('button', { name: 'Hide Places', exact: true }).click()
    await page.setViewportSize({ width: 2560, height: 850 })
    await page.getByRole('button', { name: 'Show Places', exact: true }).waitFor()
    expect(await page.locator('#task-panel').count()).toBe(0)
    await page.close()
  })

  test('a drawer open while widening does not reopen when the window narrows again', async () => {
    const page = await browser!.newPage({ viewport: { width: 1100, height: 850 } })
    await page.goto(url())
    await page.getByRole('button', { name: 'Places', exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).waitFor()
    await page.setViewportSize({ width: 1180, height: 850 })
    await page.getByRole('button', { name: 'Hide Places', exact: true }).waitFor()
    await page.setViewportSize({ width: 1100, height: 850 })
    await settled(page)
    expect(await page.getByRole('button', { name: 'Close', exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: 'Places', exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).waitFor()
    await page.close()
  })

  test('a tablet resizes tasks only; a phone keeps its drawer', async () => {
    const tablet = await browser!.newPage({ viewport: { width: 900, height: 800 } })
    await tablet.goto(url())
    await tablet.getByRole('separator', { name: 'Resize tasks' }).waitFor()
    expect(await tablet.getByRole('separator', { name: 'Resize places' }).count()).toBe(0)
    expect(await tablet.getByRole('button', { name: /^(Hide|Show) Places$/ }).count()).toBe(0)
    const before = await width(tablet, tasks)
    await drag(tablet, 'Resize tasks', -40)
    expect(await width(tablet, tasks)).toBe(Math.min(before + 40, 900 - 480))
    await tablet.close()
    const phone = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await phone.goto(url())
    await phone.getByRole('button', { name: 'Places' }).waitFor()
    expect(await phone.getByRole('separator').count()).toBe(0)
    expect(await phone.getByRole('button', { name: /^(Hide|Show) Places$/ }).count()).toBe(0)
    await phone.close()
  })
})

describe.skipIf(!browser)("a place's coordinator timer", () => {
  for (const [name, opts] of [
    ['phone, dark', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' }],
    ['phone, light', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'light' }],
    ['desktop, light', { viewport: { width: 1600, height: 900 }, colorScheme: 'light' }],
    ['desktop, dark', { viewport: { width: 1600, height: 900 }, colorScheme: 'dark' }],
  ] as const)
    test(`is a switch at the top of the ⋯ menu, over search and the terminal; a pill beside that menu shows it only while on (${name})`, async () => {
      const ctx = await browser!.newContext(opts)
      const page = await ctx.newPage()
      await page.goto(url())
      await page.getByRole('button', { name: 'Menu', exact: true }).waitFor()
      // with coordinator timer off the header says nothing of it
      const pill = page.locator('[data-chrome] button[data-mode]')
      expect(await pill.count()).toBe(0)
      // no switch in the + menu: that keeps files, model and effort
      await page.locator('[data-composer] button[aria-label="Attach files and more"]').first().click()
      await page.getByRole('menuitem', { name: 'File or photo' }).waitFor()
      expect(await page.getByRole('menuitemcheckbox', { name: 'Coordinator timer' }).count()).toBe(0)
      await page.keyboard.press('Escape')
      // the ⋯ menu: the switch first, then search, the terminal, artifacts; no three-way picker
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      const pop = page.getByRole('menu', { name: 'Menu' })
      const sw = pop.getByRole('menuitemcheckbox', { name: 'Coordinator timer' })
      await sw.waitFor()
      expect(await pop.getByRole('menuitem').allTextContents()).toEqual([
        expect.stringContaining('Search in this chat'),
        'Restart agent…',
        expect.stringContaining('Terminal'),
        'Artifacts',
      ])
      expect(await pop.locator('[role=group]').count()).toBe(0)
      expect(await sw.getAttribute('aria-checked')).toBe('false')
      expect(await pop.getByText('Off: does what you ask').count()).toBe(1)
      // a row as tall as the menu's other rows, its icon in their icon slot, its switch inside
      await settled(page)
      const items = await pop
        .locator('[role=menuitem]')
        .evaluateAll((bs) => bs.map((b) => ({ h: b.getBoundingClientRect().height, slot: b.firstElementChild!.getBoundingClientRect().left })))
      const row = await sw.evaluate((b) => ({ h: b.getBoundingClientRect().height, slot: b.firstElementChild!.getBoundingClientRect().left }))
      expect(row.h).toBeCloseTo(items[0].h, 1)
      expect(row.slot).toBeCloseTo(items[0].slot, 1)
      const [menu, s] = [(await pop.boundingBox())!, (await sw.boundingBox())!]
      expect(s.x).toBeGreaterThanOrEqual(menu.x)
      expect(s.x + s.width).toBeLessThanOrEqual(menu.x + menu.width + 0.5)
      // on: the pill shows, red, and the switch says so; the menu stays open
      await sw.click()
      await pill.waitFor()
      expect(await sw.getAttribute('aria-checked')).toBe('true')
      expect(await pill.innerText()).toBe('Coordinator timer')
      expect(await pill.getAttribute('aria-label')).toBe('coordinator timer is on. Change it')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      // off again: the pill goes, for the tests after
      await sw.click()
      await page.waitForFunction(() => !document.querySelector('[data-chrome] button[data-mode]'))
      expect(await sw.getAttribute('aria-checked')).toBe('false')
      await ctx.close()
    })

  for (const [name, opts] of [
    ['phone, dark', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' }],
    ['desktop, light', { viewport: { width: 1440, height: 800 }, colorScheme: 'light' }],
  ] as const)
    test(`a sidebar row on coordinator timer has a red dot just before its name, clear of the chevrons; no name moves (${name})`, async () => {
      const on = ['p:vm-str:~', 'p:mac:~', 'p:vm-str:gtm']
      const was = on.map((id) => world.places.find((p) => p.id === id)!.mode)
      const ctx = await browser!.newContext(opts)
      const page = await ctx.newPage()
      await page.goto(url())
      // a phone's places are in its drawer
      const side = opts.viewport.width < 600 ? 'nav[aria-label="Places"]' : '#places'
      if (side !== '#places') await page.getByRole('button', { name: 'Places' }).first().click()
      await page.waitForSelector(`${side} li`)
      await settled(page)
      const rows = () =>
        page.$$eval(`${side} li[data-project]`, (ls) =>
          ls.map((l) => {
            const go = l.querySelector('button[aria-label]:not([aria-expanded]):not([aria-haspopup])')!
            const fold = l.querySelector('button[aria-label^="Show "], button[aria-label^="Hide "]')?.getBoundingClientRect()
            const mark = l.querySelector('[data-autopilot]')
            const m = mark?.getBoundingClientRect()
            // the place's icon, between the mark and the name (SHE-207)
            const icon = mark?.nextElementSibling?.getBoundingClientRect()
            return {
              said: go.getAttribute('aria-label')!,
              name: go.getBoundingClientRect().left,
              fold: fold?.right,
              icon: icon && { left: icon.left, right: icon.right },
              mark: m && {
                left: m.left,
                right: m.right,
                w: m.width,
                h: m.height,
                round: parseFloat(getComputedStyle(mark!).borderRadius) >= m.width / 2,
                hidden: mark!.getAttribute('aria-hidden'),
              },
            }
          }),
        )
      const before = await rows()
      expect(before.every((r) => !r.mark)).toBe(true)
      for (const id of on) await world.act({ type: 'mode', place: id, mode: 'autopilot' })
      await page.waitForFunction(([s, n]) => document.querySelectorAll(`${s} [data-autopilot]`).length === n, [side, on.length] as const)
      const after = await rows()
      // every name where it was, on coordinator timer or not
      expect(after.map((r) => r.name)).toEqual(before.map((r) => r.name))
      for (const r of after.filter((r) => r.mark)) {
        // just before the space's # and its name, clear of the headings' chevrons
        expect(r.icon!.left - r.mark!.right).toBeWithin(0, 6)
        expect(r.name - r.icon!.right).toBeWithin(0, 8)
        if (r.fold !== undefined) expect(r.mark!.left).toBeGreaterThanOrEqual(r.fold)
        // the dot in its round tint, as the header's pill without the word; screen readers hear it in the row's name
        expect(r.mark!.w).toBeWithin(12, 18)
        expect(r.mark!.h).toBe(r.mark!.w)
        expect(r.mark!.round).toBe(true)
        expect(r.mark!.hidden).toBe('true')
        expect(r.said).toContain(', on coordinator timer')
      }
      expect(after.filter((r) => r.mark).length).toBe(on.length)
      expect(
        await page
          .locator(`${side} [data-autopilot]`)
          .first()
          .evaluate((e) => getComputedStyle(e, '::before').backgroundColor),
      ).not.toBe('rgba(0, 0, 0, 0)')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      for (const [i, id] of on.entries()) await world.act({ type: 'mode', place: id, mode: was[i] })
      // each switch left a card in its chat: read, for the tests after
      const last = world.snapshot().last ?? {}
      await world.act({ type: 'read', chats: Object.fromEntries(on.map((id) => [id, last[id]])) })
      await page.waitForFunction((s) => !document.querySelector(`${s} [data-autopilot]`), side)
      await ctx.close()
    })

  test("a task's attachment menu keeps files; agent controls live inside it on a small phone", async () => {
    const page = await browser!.newPage({ viewport: { width: 320, height: 640 }, hasTouch: true })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=all&task=GTM-14`)
    await page.locator('[data-composer]').first().waitFor()
    expect(await page.locator('[data-agent-controls]').count()).toBe(0)
    await page.locator('[data-composer] button[aria-label="Attach files and more"]').first().click()
    await page.getByRole('menuitem', { name: 'File or photo' }).waitFor()
    expect(await page.getByRole('combobox', { name: 'Model' }).count()).toBe(0)
    expect(await page.getByRole('group', { name: 'Mode', exact: true }).count()).toBe(0)
    expect(await page.locator('[data-agent-controls] [role=menuitem]').count()).toBe(3)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.close()
  })
})
