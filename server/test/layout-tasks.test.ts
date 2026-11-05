import { browser, world, server, url, headings, pick, subs, macChip } from './layout-tasks-fixture.ts'
import { describe, expect, test } from 'bun:test'
import type { Page } from 'playwright-core'

describe.skipIf(!browser)("the agent's status line, % done and minutes left", () => {
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1600, height: 900 }],
  ] as const)
    test(`the dot shows the %, the minutes sit under it, the age stays at the row's end; paused, all of it frozen (${name})`, async () => {
      const page = await browser!.newPage({ viewport, hasTouch: name === 'phone' })
      await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home&tab=tasks`)
      const working = page.getByRole('button', { name: /HP-202 Voice/ })
      await working.waitFor()
      const wtext = (await working.textContent())!
      expect(wtext).toContain('Tracing why mute ends the call')
      expect(wtext).not.toContain('· ~12 min')
      expect(wtext).not.toContain('40%')
      const dot = working.getByRole('img', { name: 'Working, 40% done' })
      expect(await dot.evaluate((d) => getComputedStyle(d).getPropertyValue('--p').trim())).toBe('40%')
      // the minutes: small, under the dot and centred on it, in the dot's orange, level with the status line
      const eta = working.getByText('12m', { exact: true })
      const [d, e, line] = [
        (await dot.boundingBox())!,
        (await eta.boundingBox())!,
        (await working.getByText('Tracing why mute ends the call', { exact: true }).boundingBox())!,
      ]
      expect(e.y).toBeGreaterThanOrEqual(d.y + d.height)
      expect(Math.abs(e.x + e.width / 2 - (d.x + d.width / 2))).toBeLessThan(1)
      expect(Math.abs(e.y + e.height / 2 - (line.y + line.height / 2))).toBeLessThan(3)
      expect(e.height).toBeLessThan(line.height + 1)
      const work = await dot.evaluate((x) => getComputedStyle(x).getPropertyValue('--work').trim())
      expect(
        await eta.evaluate((x, c) => {
          const probe = document.createElement('span')
          probe.style.color = c
          document.body.append(probe)
          const same = getComputedStyle(probe).color === getComputedStyle(x).color
          probe.remove()
          return same
        }, work),
      ).toBe(true)
      expect(wtext).toContain(', about 12 min left')
      // the dot's column keeps its width: the title starts where the other rows' titles do
      const left = (row: import('playwright-core').Locator) => row.evaluate((r) => r.querySelector(':scope > span.flex-1')!.getBoundingClientRect().left)
      expect(await left(working)).toBe(await left(page.getByRole('button', { name: /GTM-16/ })))
      // its age sits at the row's end, whole, as on every row: the title and the status line stop short of it
      const age = await working.evaluate((row) => {
        const [title, age] = [row.querySelector(':scope > span.flex-1')!, row.querySelector<HTMLElement>(':scope > span.tabular-nums')!]
        const [t, a, r] = [title.getBoundingClientRect(), age.getBoundingClientRect(), row.getBoundingClientRect()]
        return { text: age.textContent, gap: a.left - t.right, inside: a.right <= r.right, whole: age.scrollWidth <= age.clientWidth }
      })
      expect(age.text).toBe('8m')
      expect(age.gap).toBeGreaterThanOrEqual(0)
      expect(age).toMatchObject({ inside: true, whole: true })
      // waiting on you: only what it asks, one line like the rows around it; the frozen status line stays in its header
      const paused = page.getByRole('button', { name: /GTM-14/ })
      const text = (await paused.textContent())!
      expect(text).toContain('Asks permission')
      expect(text).not.toMatch(/Moving the skills|Paused|62%|min/)
      const height = (row: import('playwright-core').Locator) => row.evaluate((r) => r.getBoundingClientRect().height)
      expect(await height(paused)).toBe(await height(page.getByRole('button', { name: /GTM-16/ })))
      // an open task: what it does, then the minutes left; no bar along the header's edge
      await working.click()
      await page.getByText(name === 'phone' ? /^Tracing why mute ends the call ?· ~12 min$/ : /^Tracing why mute ends the call ?· ~12 min left$/).waitFor()
      expect(await page.getByRole('progressbar').count()).toBe(0)
      await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home&task=GTM-14`)
      await page.getByText(/^Moving the skills into the template ?· 62%$/).waitFor()
      expect(await page.getByRole('progressbar').count()).toBe(0)
      // a coordinator at work reports no progress: its header keeps its name and its usual subtitle, no %, minutes or bar
      await page.goto(`http://127.0.0.1:${server!.port}/?place=p:vm-str:gtm`)
      await page.getByText('gtm', { exact: true }).first().waitFor()
      const top = await page.evaluate(
        () => [...document.querySelectorAll('.border-b')].find((el) => !el.closest('#places, nav') && el.textContent?.includes('gtm'))?.textContent ?? '',
      )
      expect(top).toMatch(/Space on vm-str$/)
      expect(top).not.toMatch(/\d+%|~\d+ min|Checking/)
      expect(await page.getByRole('progressbar').count()).toBe(0)
      await page.close()
    })

  test("a narrow tasks sidebar keeps the age whole at the row's end and the minutes whole under the dot, in its orange (light and dark)", async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const page = await browser!.newPage({ viewport: { width: 1440, height: 800 }, colorScheme: scheme })
      await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home`)
      const sep = page.getByRole('separator', { name: 'Resize tasks' })
      await sep.waitFor()
      // drag the tasks sidebar as narrow as it goes
      const s = (await sep.boundingBox())!
      await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
      await page.mouse.down()
      await page.mouse.move(s.x + 400, s.y + s.height / 2, { steps: 6 })
      await page.mouse.up()
      await page.waitForTimeout(350)
      const working = page.getByRole('button', { name: /HP-202 Voice/ })
      const row = (await working.boundingBox())!
      // its age stays whole at the row's end; the title and the status line take the rest
      const room = await working.evaluate((r) => {
        const age = r.querySelector<HTMLElement>(':scope > span.tabular-nums')!
        return {
          gap: age.getBoundingClientRect().left - r.querySelector(':scope > span.flex-1')!.getBoundingClientRect().right,
          whole: age.scrollWidth <= age.clientWidth,
        }
      })
      expect(room.gap).toBeGreaterThanOrEqual(0)
      expect(room.whole).toBe(true)
      expect(await working.getByText('· ~12 min').count()).toBe(0)
      // the minutes stay whole inside the row, under the dot
      const end = working.getByText('12m', { exact: true })
      const box = (await end.boundingBox())!
      expect(box.width).toBeGreaterThan(10)
      expect(box.x).toBeGreaterThanOrEqual(row.x)
      // in the dot's orange, apart from what it does, in either theme
      const color = (l: import('playwright-core').Locator) => l.evaluate((e) => getComputedStyle(e).color)
      expect(await color(end)).not.toBe(await color(working.getByText('Tracing why mute ends the call', { exact: true })))
      expect(await color(end)).toBe(
        await working.getByRole('img', { name: /Working/ }).evaluate((d) => {
          const probe = document.createElement('span')
          probe.style.color = getComputedStyle(d).getPropertyValue('--work')
          document.body.append(probe)
          const c = getComputedStyle(probe).color
          probe.remove()
          return c
        }),
      )
      await page.close()
    }
  })
})

describe.skipIf(!browser)("grouping a machine's tasks", () => {
  const labels = (page: Page) => headings(page, 'section[aria-label="Tasks"] ')
  const phoneLabels = (page: Page) => headings(page)

  test("a machine's chip: Status or Space from the Tasks header's ⋯, kept on this device; a space has no ⋯", async () => {
    const ctx = await browser!.newContext({ viewport: { width: 1440, height: 800 } })
    await ctx.addInitScript(macChip)
    const page = await ctx.newPage()
    // mac's home space, its chip mac's: mac's tasks
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:mac:~')}`)
    await page.waitForSelector('section[aria-label="Tasks"] li')
    expect(await labels(page)).toEqual(['Needs you', 'To do'])
    await page.getByRole('button', { name: 'Group tasks' }).click()
    // a home space offers Status and Space; Status is checked
    const items = page.getByRole('menuitemradio')
    expect(await items.allTextContents()).toEqual(['Status', 'Space'])
    expect(await items.first().getAttribute('aria-checked')).toBe('true')
    await page.keyboard.press('Escape')
    await pick(page, 'Space')
    expect(await labels(page)).toEqual(['lilla-varlden'])
    // the first space's tasks, Needs you first
    const dots = await page.$$eval('section[aria-label="Tasks"] .overflow-y-auto > div:not([data-filter]) > div:first-child li .dot', (d) =>
      d.map((x) => [...x.classList].find((c) => ['need', 'ready', 'merging', 'work', 'todo', 'done'].includes(c))),
    )
    expect(dots).toEqual(['need', 'need'])
    // kept: after a reload
    await page.reload()
    await page.waitForSelector('section[aria-label="Tasks"] li')
    expect(await labels(page)).toEqual(['lilla-varlden'])
    // a space's own list is by status, with no ⋯
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}`)
    await page.waitForSelector('section[aria-label="Tasks"] li')
    expect(await labels(page)).toEqual(['Needs you', 'Ready', 'Merging', 'To do', 'Done'])
    expect(await page.getByRole('button', { name: 'Group tasks' }).count()).toBe(0)
    await ctx.close()
  })

  test('the main home space: Status across every machine, Machine, Space or Machine › Space; each row says where it is only where nothing else does', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 1024, height: 768 } })
    const page = await ctx.newPage()
    await page.goto(url())
    await page.waitForSelector('section[aria-label="Tasks"] li')
    await page.getByRole('button', { name: 'Group tasks' }).click()
    expect(await page.getByRole('menuitemradio').allTextContents()).toEqual(['Status', 'Machine', 'Space', 'Machine › Space'])
    await page.keyboard.press('Escape')
    // gtm's archived tasks are in no group: the Archived link at the bottom opens them
    expect(await page.getByRole('button', { name: /^Archived\s*2$/ }).count()).toBe(1)
    // by status: one Needs you for every machine, not split by machine again; each row names its machine and space
    expect(await labels(page)).toEqual(['Needs you', 'Ready', 'Merging', 'Working', 'Queued', 'To do', 'Done'])
    let s = await subs(page)
    expect(s['GTM-14']).toBe('vm-str · gtm · Asks permission')
    expect(s['LV-3']).toStartWith('mac · lilla-varlden · ')
    // its pull request's number gives way to where it is
    expect(s['GTM-15']).toBe('vm-str · gtm · Ready to merge')
    await pick(page, 'Machine')
    expect(await labels(page)).toEqual(['mac', 'vm-str'])
    s = await subs(page)
    expect(s['GTM-14']).toBe('gtm · Asks permission')
    await pick(page, 'Space')
    expect(await labels(page)).toEqual(['lilla-varlden', 'gtm', 'herdr-projects'])
    // the heading says the machine, quietly: the rows say neither
    expect(await page.locator('[data-heading="gtm"]').textContent()).toBe('gtm · vm-str6')
    s = await subs(page)
    expect([s['GTM-14'], s['GTM-15']]).toEqual(['Asks permission', 'PR #128 · Ready to merge'])
    await pick(page, 'Machine › Space')
    expect(await labels(page)).toEqual(['mac', 'lilla-varlden', 'vm-str', 'gtm', 'herdr-projects'])
    expect((await subs(page))['GTM-14']).toBe('Asks permission')
    // the machine's name a step above its groups' labels
    const weight = (name: string) =>
      page
        .locator(`[data-heading="${name}"] button > :not(svg)`)
        .first()
        .evaluate((e) => Number(getComputedStyle(e).fontWeight))
    expect(await weight('vm-str')).toBeGreaterThan(await weight('gtm'))
    // a machine's chip keeps its own choice: still by status there, its rows naming only their space
    await ctx.addInitScript(macChip)
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:mac:~')}`)
    await page.waitForSelector('section[aria-label="Tasks"] li')
    expect(await labels(page)).toEqual(['Needs you', 'To do'])
    expect((await subs(page))['LV-3']).toStartWith('lilla-varlden · ')
    // a space's rows say neither
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}`)
    await page.waitForSelector('section[aria-label="Tasks"] li')
    expect((await subs(page))['GTM-14']).toBe('Asks permission')
    await ctx.close()
  })

  test('a phone: the ⋯ sits at the top right of Tasks, its menu stays on screen', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' })
    await ctx.addInitScript(macChip)
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:mac:~')}&tab=tasks`)
    await page.waitForSelector('li')
    const btn = await page.getByRole('button', { name: 'Group tasks' }).boundingBox()
    expect(btn!.width).toBeGreaterThanOrEqual(44)
    expect(390 - (btn!.x + btn!.width)).toBeLessThan(20)
    await pick(page, 'Space')
    expect(await phoneLabels(page)).toEqual(['lilla-varlden'])
    await page.getByRole('button', { name: 'Group tasks' }).click()
    const menu = await page.getByRole('menu').boundingBox()
    expect(menu!.x).toBeGreaterThanOrEqual(0)
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(390)
    // Chat: the ⋯ is the coordinator's menu again, not this one
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Chat', exact: true }).click()
    expect(await page.getByRole('button', { name: 'Group tasks' }).count()).toBe(0)
    await ctx.close()
  })
})

/** seven more Done tasks in gtm, enough to cut its Done group short; the caller takes them away again */
const addOldDone = () => {
  const done = world.tasks.find((t) => t.status === 'done' && t.place === 'p:vm-str:gtm')!
  const extra = Array.from({ length: 7 }, (_, i) => ({ ...done, id: `GTM-D${i}`, name: `Old job ${i}`, report: undefined }))
  world.tasks.push(...extra)
  return extra
}

describe.skipIf(!browser)('folding headings', () => {
  const rows = (page: Page) => page.$$eval('section[aria-label="Tasks"] li[data-flip]', (li) => li.map((l) => l.textContent?.match(/^[A-Z]+-[A-Z0-9]+/)?.[0]))
  const heading = (page: Page, name: string) => page.locator(`section[aria-label="Tasks"] [data-heading="${name}"] button`)
  const labels = (page: Page) => headings(page, 'section[aria-label="Tasks"] ')

  test('a tap folds a heading, its count stays; Alt-click folds its siblings too; kept per view on this device; a filter shows every match', async () => {
    const extra = addOldDone()
    try {
      const ctx = await browser!.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await ctx.newPage()
      await page.goto(url())
      await page.waitForSelector('section[aria-label="Tasks"] li')
      await pick(page, 'Machine › Space')
      // the sidebar's chevron, pointing down while open
      expect(await heading(page, 'gtm').getAttribute('aria-expanded')).toBe('true')
      await heading(page, 'gtm').click()
      expect(await heading(page, 'gtm').getAttribute('aria-expanded')).toBe('false')
      expect((await rows(page)).some((r) => r?.startsWith('GTM-'))).toBe(false)
      // its count stays
      expect(await heading(page, 'gtm').textContent()).toBe('gtm13')
      // Alt-click on a machine folds every machine; its count stays too
      await heading(page, 'mac').click({ modifiers: ['Alt'] })
      expect(await labels(page)).toEqual(['mac', 'vm-str'])
      expect(await rows(page)).toEqual([])
      expect(await heading(page, 'vm-str').textContent()).toBe('vm-str17')
      // a filter shows its matches, folded or not, and the fold comes back after
      await page.getByPlaceholder('Filter tasks').fill('webhook')
      expect(await rows(page)).toEqual(['GTM-15', 'GTM-18', 'GTM-17'])
      await page.getByPlaceholder('Filter tasks').fill('')
      expect(await rows(page)).toEqual([])
      // kept on this device: after a reload too
      await page.reload()
      await page.waitForSelector('section[aria-label="Tasks"] [data-heading]')
      expect(await rows(page)).toEqual([])
      // Alt-click again opens them all; gtm, folded on its own, stays folded
      await heading(page, 'vm-str').click({ modifiers: ['Alt'] })
      expect(await labels(page)).toEqual(['mac', 'lilla-varlden', 'vm-str', 'gtm', 'herdr-projects'])
      expect((await rows(page)).some((r) => r?.startsWith('LV-'))).toBe(true)
      expect((await rows(page)).some((r) => r?.startsWith('GTM-'))).toBe(false)
      // each view its own: gtm's own Done shows, with its Show all, until folded; Alt-click folds every status
      await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}`)
      await page.waitForSelector('section[aria-label="Tasks"] li')
      await page.getByRole('button', { name: 'Show all 8' }).waitFor()
      await heading(page, 'Done').click()
      expect(await page.getByRole('button', { name: 'Show all 8' }).count()).toBe(0)
      await heading(page, 'Done').click()
      await page.getByRole('button', { name: 'Show all 8' }).waitFor()
      await heading(page, 'Ready').click({ modifiers: ['Alt'] })
      expect(await rows(page)).toEqual([])
      for (const name of ['Needs you', 'Ready', 'Merging', 'To do', 'Done']) expect(await heading(page, name).getAttribute('aria-expanded')).toBe('false')
      await ctx.close()
    } finally {
      world.tasks.splice(world.tasks.length - extra.length, extra.length)
    }
  })

  test('a phone: a heading is a full-width tap target a finger can hit', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}&tab=tasks`)
    await page.waitForSelector('li')
    const box = (await page.locator('[data-heading="Needs you"] button').boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThan(340)
    await page.locator('[data-heading="Needs you"] button').tap()
    expect(await page.locator('[data-heading="Needs you"] button').getAttribute('aria-expanded')).toBe('false')
    expect(await page.locator('li', { hasText: 'GTM-14' }).count()).toBe(0)
    // a row's line stays one line on a phone, all of it inside the row
    await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home&tab=tasks`)
    await page.waitForSelector('li')
    const lines = await page.$$eval('li .text-xs\\/4', (els) =>
      els.map((e) => ({ h: e.getBoundingClientRect().height, over: e.getBoundingClientRect().right > innerWidth })),
    )
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l).toEqual({ h: lines[0].h, over: false })
    await ctx.close()
  })
})

describe.skipIf(!browser)('grouped tasks and the keyboard', () => {
  test('the arrow keys walk the rows on screen, group by group, past Done ones hidden until Show all', async () => {
    const extra = addOldDone()
    try {
      const ctx = await browser!.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await ctx.newPage()
      await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home`)
      const taskRows = 'section[aria-label="Tasks"] li[data-flip]'
      await page.waitForSelector(taskRows)
      await page.getByRole('button', { name: 'Group tasks' }).click()
      await page.getByRole('menuitemradio', { name: /^Space/ }).click()
      await page.locator('body').click({ position: { x: 600, y: 500 } })
      // The footer has automation list items too; only task rows belong to the arrow-key order.
      const automations = page.locator('section[aria-label="Tasks"] li[aria-expanded]')
      expect(await automations.count()).toBe(3)
      const rows = await page.$$eval(taskRows, (li) => li.map((l) => (l as HTMLElement).dataset.flip!))
      const focused = () => page.$$eval(taskRows, (li) => (li.find((l) => l.className.includes('var(--focus)')) as HTMLElement | undefined)?.dataset.flip)
      const seen: (string | undefined)[] = []
      for (let i = 0; i < rows.length; i++) {
        if (i) await page.keyboard.press('ArrowDown')
        else await page.keyboard.press('ArrowUp')
        seen.push(await focused())
      }
      // every press lands on the next row you can see, lilla-varlden's, then gtm's five Done ones and straight on to herdr-projects
      expect(seen).toEqual(rows)
      // The footer stays visible, but extra presses stop at the last task, then walk back up.
      await page.keyboard.press('ArrowDown')
      expect(await focused()).toBe(rows.at(-1))
      const back = [await focused()]
      for (let i = 1; i < rows.length; i++) {
        await page.keyboard.press('ArrowUp')
        back.push(await focused())
      }
      expect(back).toEqual([...rows].reverse())
      expect(await automations.count()).toBe(3)
      expect(rows.filter((r) => r?.startsWith('GTM-')).length).toBe(5 + 5)
      await page.getByRole('button', { name: 'Show all 8' }).click()
      expect(await page.locator(taskRows).count()).toBe(rows.length + 3)
      // remembered on this device: a reload still shows them all, and Show less cuts them short again
      await page.reload()
      await page.waitForSelector(taskRows)
      expect(await page.locator(taskRows).count()).toBe(rows.length + 3)
      await page.getByRole('button', { name: 'Show less' }).click()
      expect(await page.locator(taskRows).count()).toBe(rows.length)
      await page.reload()
      await page.waitForSelector(taskRows)
      await page.getByRole('button', { name: 'Show all 8' }).waitFor()
      await ctx.close()
    } finally {
      world.tasks.splice(world.tasks.length - extra.length, extra.length)
    }
  })
})
