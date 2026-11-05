import { browser, url } from './layout-message-box-fixture.ts'
import { describe, expect, test } from 'bun:test'
import type { Page } from 'playwright-core'
import { pills, type Box } from './layout.ts'

describe.skipIf(!browser)('a long message in the box', () => {
  const long = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} of a long prompt that keeps going.`).join(' ')
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1280, height: 800 }],
  ] as const)
    test(`the buttons keep their size and spot while the words grow the box upward (${name})`, async () => {
      const page = await browser!.newPage({ viewport, hasTouch: name === 'phone', isMobile: name === 'phone' })
      await page.goto(url())
      const box = page.locator('[data-composer]').first()
      const text = page.locator('textarea[name=message]').first()
      await text.waitFor()
      const rect = (l: typeof box) => l.evaluate((el) => el.getBoundingClientRect().toJSON()) as Promise<Box & { width: number; height: number }>
      const send = page.locator('[data-composer] button[aria-label=Send]').first()
      const plus = page.locator('[data-composer] button[aria-label="Attach files and more"]').first()
      const mic = page.locator('[data-composer] button[aria-label="Talk to type"]').first()
      await text.focus()
      await text.fill('Run the tests again')
      const one = await rect(box)
      const [p0, m0, s0] = await Promise.all([plus, mic, send].map(rect))
      const size = name === 'phone' ? 44 : 34
      for (const r of [p0, m0, s0]) expect([r.width, r.height]).toEqual([size, size])
      // at every length, from one line to past the max height, and with a line break: the same buttons in the same
      // spots, the words between them, and the box taller only upward
      for (const words of [...[1, 2, 3, 8, 30].map((n) => long.split('. ').slice(0, n).join('. ')), 'One\nTwo']) {
        await text.fill(words)
        await page.waitForTimeout(50)
        const [b, t, ...btns] = await Promise.all([box, text, plus, mic, send].map(rect))
        btns.forEach((r, k) => expect(r).toEqual([p0, m0, s0][k]))
        expect(t.left).toBeGreaterThanOrEqual(p0.right)
        expect(t.right).toBeLessThanOrEqual(m0.left)
        expect(Math.abs(b.bottom - one.bottom)).toBeLessThan(0.5)
        expect(b.height).toBeGreaterThanOrEqual(one.height)
        expect(b.height).toBeLessThan(viewport.height * 0.4)
        // every button sits as far from the bottom as from the side
        expect(Math.abs(b.bottom - p0.bottom - (p0.left - b.left))).toBeLessThan(0.5)
        expect(Math.abs(b.bottom - s0.bottom - (b.right - s0.right))).toBeLessThan(0.5)
      }
      expect((await rect(box)).height).toBeGreaterThan(one.height)
      // past the max height the words scroll inside, the end in full view as you type, fading at the cut edge
      await text.fill(long)
      await text.press('End')
      await text.pressSequentially(' And more.')
      await page.waitForTimeout(50)
      const scroll = await text.evaluate((el) => ({
        scrolls: el.scrollHeight > el.clientHeight,
        atEnd: Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 2,
        up: el.hasAttribute('data-more-up'),
        down: el.hasAttribute('data-more-down'),
      }))
      expect(scroll).toEqual({ scrolls: true, atEnd: true, up: true, down: false })
      // it stays the same box: still focused, and clearing it brings back the one round row
      expect(await text.evaluate((el) => el === document.activeElement)).toBe(true)
      await text.fill('')
      await page.waitForTimeout(50)
      expect((await rect(box)).height).toBe(one.height)
      await page.close()
    })
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1280, height: 800 }],
  ] as const)
    test(`the line you type stays in full view, faded only where words are hidden (${name})`, async () => {
      const page = await browser!.newPage({ viewport, hasTouch: name === 'phone', isMobile: name === 'phone' })
      await page.goto(url())
      const text = page.locator('textarea[name=message]').first()
      await text.waitFor()
      const box = () =>
        text.evaluate((el) => {
          const cs = getComputedStyle(el)
          const [pt, pb, lh] = [cs.paddingTop, cs.paddingBottom, cs.lineHeight].map(parseFloat)
          const fade = (v: string) => (v.trim().endsWith('px') ? parseFloat(v) : Infinity)
          return {
            lines: (el.clientHeight - pt - pb) / lh,
            atEnd: Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 1,
            up: el.hasAttribute('data-more-up'),
            down: el.hasAttribute('data-more-down'),
            // the fades reach no further in than the padding: never over a whole line
            fades: fade(cs.getPropertyValue('--fade-up')) <= pt && fade(cs.getPropertyValue('--fade-down')) <= pb,
          }
        })
      /** line i (from 0) is in full view, the padding round it clear of the edges, so no fade is on it */
      const shows = (i: number) =>
        text.evaluate((el, i) => {
          const cs = getComputedStyle(el)
          const [pt, pb, lh] = [cs.paddingTop, cs.paddingBottom, cs.lineHeight].map(parseFloat)
          return el.scrollTop <= i * lh + 0.5 && el.scrollTop + el.clientHeight >= pt + (i + 1) * lh + pb - 0.5
        }, i)
      // typing at the end of a long message: whole lines, the end in view, only the top edge fades, and only over the
      // padding
      await text.focus()
      await text.fill(long)
      await text.pressSequentially(' ofc we')
      const b = await box()
      expect(Number.isInteger(b.lines)).toBe(true)
      expect(b).toMatchObject({ atEnd: true, up: true, down: false, fades: true })
      // a phone shows the caret itself after each letter, stopping a little short of the padding: it comes back
      await text.evaluate((el) =>
        document.addEventListener(
          'input',
          () => queueMicrotask(() => (el.scrollTop = el.scrollHeight - el.clientHeight - parseFloat(getComputedStyle(el).paddingBottom) + 1)),
          { once: true },
        ),
      )
      await text.press('x')
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      expect(await box()).toMatchObject({ atEnd: true, down: false })
      // typing or moving the caret in the middle: its line comes into full view, the words past it fading at the edge
      const rows = Array.from({ length: 20 }, (_, i) => `line ${i + 1} gjpqy`).join('\n')
      await text.fill(rows)
      await text.evaluate(
        (el, at) => {
          el.scrollTop = 0
          ;(el as HTMLTextAreaElement).setSelectionRange(at, at)
        },
        rows.indexOf('\n', rows.indexOf('line 10 ')),
      )
      await text.press('Z')
      expect(await shows(9)).toBe(true)
      expect(await box()).toMatchObject({ up: true, down: true })
      for (let i = 0; i < 10; i++) await text.press('ArrowDown')
      expect(await shows(19)).toBe(true)
      expect(await box()).toMatchObject({ atEnd: true, down: false })
      for (let i = 0; i < 15; i++) await text.press('ArrowUp')
      expect(await shows(4)).toBe(true)
      // a shorter screen (a phone's keyboard up) fits fewer whole lines; taller again, it grows back at once
      const full = (await box()).lines
      await page.setViewportSize({ width: viewport.width, height: 420 })
      await page.waitForTimeout(100)
      const short = (await box()).lines
      expect(Number.isInteger(short)).toBe(true)
      expect(short).toBeLessThan(full)
      await page.setViewportSize(viewport)
      await page.waitForTimeout(100)
      expect((await box()).lines).toBe(full)
      await page.close()
    })
  test('the chat stays on its newest message as the box grows; read further up, it keeps its bottom edge', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.goto(url())
    await page.waitForSelector('[data-msg="short-agent"]')
    await page.waitForTimeout(300)
    const text = page.locator('textarea[name=message]').first()
    const list = () => document.querySelector('[data-msg]')!.closest('.overflow-y-auto') as HTMLElement
    const left = () =>
      page.evaluate((l) => {
        const el = (eval(l) as () => HTMLElement)()
        return el.scrollHeight - el.scrollTop - el.clientHeight
      }, list.toString())
    const jump = () => page.$('button[aria-label$="to the latest"]')
    await text.focus()
    await text.fill(long)
    // a chat only a little taller than its view, at its newest message: each letter measures the box, and the chat
    // must not grow for that moment, or it would be pulled up off its newest message and the arrow would show
    await page.evaluate((l) => {
      const el = (eval(l) as () => HTMLElement)()
      const inner = el.firstElementChild as HTMLElement
      for (const c of inner.children) (c as HTMLElement).style.display = 'none'
      const rest = document.createElement('div')
      rest.style.height = `${el.clientHeight + 100}px`
      rest.style.flex = 'none'
      inner.appendChild(rest)
      el.scrollTop = el.scrollHeight
    }, list.toString())
    await page.waitForTimeout(100)
    for (const k of ' ofc we') {
      await text.press(k === ' ' ? 'Space' : k)
      expect(await left()).toBeLessThan(2)
      expect(await jump()).toBeNull()
    }
    // read further up: the chat keeps what was just above the box there as the box grows, and fades under the arrow
    await page.reload()
    await page.waitForSelector('[data-msg="short-agent"]')
    await text.fill('')
    await page.$eval('[data-msg="long-you"]', (m) => m.scrollIntoView({ block: 'end' }))
    await page.waitForSelector('button[aria-label$="to the latest"]')
    expect(await page.$('[data-fade-under-jump]')).not.toBeNull()
    const above = () =>
      page.$eval('[data-msg="long-you"]', (m) => m.closest('.overflow-y-auto')!.getBoundingClientRect().bottom - m.getBoundingClientRect().bottom)
    const before = await above()
    await text.fill(long)
    await page.waitForTimeout(50)
    expect(Math.abs((await above()) - before)).toBeLessThan(1)
    await page.close()
  })
})

describe.skipIf(!browser)('the keyboard, like iMessage and Slack', () => {
  const focused = (page: Page) => page.evaluate(() => (document.activeElement as HTMLTextAreaElement | null)?.name ?? null)
  /** the box lets go: waited for, as a busy page may handle the touch that does it a moment late (checked every 50 ms:
   *  a still page may draw no frames to check on) */
  const letsGo = (page: Page) => page.waitForFunction(() => !(document.activeElement as HTMLTextAreaElement | null)?.name, null, { polling: 50, timeout: 5000 })
  const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
  const tablet = { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true }
  /** the chat open with its long messages, its box focused, and a finger on it */
  const chat = async (size: typeof phone) => {
    const ctx = await browser!.newContext(size)
    const page = await ctx.newPage()
    await page.goto(url())
    await page.locator('textarea[name=message]').first().waitFor()
    await page.waitForSelector('[data-msg="long-agent"]')
    const cdp = await ctx.newCDPSession(page)
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: y! }] })
    const slide = async (from: [number, number], to: [number, number]) => {
      await touch('touchStart', ...from)
      for (let i = 1; i <= 8; i++) await touch('touchMove', from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8)
      await touch('touchEnd')
    }
    const still = () =>
      page.waitForFunction(
        () =>
          new Promise((done) => {
            const el = document.querySelector('[data-msg]')!.closest('.overflow-y-auto')!
            const at = el.scrollTop
            setTimeout(() => done(el.scrollTop === at), 200)
          }),
      )
    const refocus = async () => {
      await still()
      // (headless Chromium now and then takes a tap after a fling as the fling's stop: tap again)
      for (let i = 0; i < 3 && (await focused(page)) !== 'message'; i++) {
        await page.tap('textarea[name=message]')
        await page
          .waitForFunction(() => (document.activeElement as HTMLTextAreaElement | null)?.name === 'message', null, { polling: 50, timeout: 1000 })
          .catch(() => {})
      }
      expect(await focused(page)).toBe('message')
    }
    await refocus()
    const x = page.viewportSize()!.width / 2
    const box = (await page.$eval('[data-composer]', (b) => b.getBoundingClientRect().toJSON())) as Box
    return { ctx, page, touch, slide, still, refocus, x, box }
  }
  test('Send, + and a reaction keep the box (and a phone its keyboard) (phone)', async () => {
    const ctx = await browser!.newContext(phone)
    const page = await ctx.newPage()
    await page.goto(url())
    const text = page.locator('textarea[name=message]').first()
    await text.waitFor()
    await page.waitForSelector('[data-msg="short-agent"]')
    // typed and sent: the box is empty and still has the focus
    await page.tap('textarea[name=message]')
    await text.fill('Run the tests again')
    await page.tap('[data-composer] button[aria-label=Send]')
    await page.waitForFunction(() => !(document.querySelector('textarea[name=message]') as HTMLTextAreaElement).value)
    expect(await focused(page)).toBe('message')
    // + opens its menu with the box still focused, and closes the same way
    await page.tap('[data-composer] button[aria-label="Attach files and more"]')
    await page.getByRole('menu', { name: 'Attach files and more' }).waitFor()
    expect(await focused(page)).toBe('message')
    await page.tap('[data-composer] button[aria-label="Attach files and more"]')
    await page.getByRole('menu', { name: 'Attach files and more' }).waitFor({ state: 'detached' })
    expect(await focused(page)).toBe('message')
    // a reaction pill tapped toggles yours and leaves the box focused
    await page.tap(`${pills('long-agent')}`)
    expect(await focused(page)).toBe('message')
    await ctx.close()
  })
  for (const [name, size] of [
    ['phone', phone],
    ['tablet', tablet],
  ] as const) {
    // as in iMessage: scrolling the chat up and down keeps the box (and the keyboard)
    test(`scrolling the chat keeps the box, sideways and the drawer's swipe too (${name})`, async () => {
      const { ctx, page, touch, slide, still, x, box } = await chat(size)
      // (what should change nothing is given a moment to: nothing to wait for)
      const keeps = async () => {
        await page.waitForTimeout(100)
        expect(await focused(page)).toBe('message')
      }
      // up, down, and up and down again in one go, a long way: the chat scrolls, the keyboard stays
      const top = () => page.evaluate(() => document.querySelector('[data-msg]')!.closest('.overflow-y-auto')!.scrollTop)
      const at = await top()
      await slide([x, 300], [x, 600])
      await still()
      const up = await top()
      expect(up).toBeLessThan(at - 100)
      await slide([x, 600], [x, 200])
      await still()
      expect(await top()).toBeGreaterThan(up + 100)
      await touch('touchStart', x, 250)
      for (const y of [400, 550, 300, 150, 500, box.top - 4]) await touch('touchMove', x, y)
      await touch('touchEnd')
      await keeps()
      // sideways keeps it too, and so does a thumb's arc from the edge that opens the drawer, dipping past the box
      await slide([x, 400], [x - 50, 405])
      await keeps()
      const y0 = box.bottom - 120
      await touch('touchStart', 4, y0)
      for (const [dx, dy] of [
        [12, 16],
        [18, 28],
        [76, 80],
        [216, 135],
      ])
        await touch('touchMove', 4 + dx, y0 + dy)
      await touch('touchEnd')
      // the drawer is out once it has stopped sliding and the app has it open (until then a swipe can't shut it)
      await page.waitForFunction(
        () => {
          const nav = document.querySelector('nav[aria-label=Places]')!
          return Math.round(nav.getBoundingClientRect().left) === 0 && !nav.closest('[inert]')
        },
        null,
        { polling: 50 },
      )
      expect(await focused(page)).toBe('message')
      // (a swipe left shuts the drawer again: gone, and shut in the app too, or its shade still takes the next touch)
      await slide([300, y0], [20, y0])
      await page.waitForFunction(
        () => {
          const nav = document.querySelector('nav[aria-label=Places]')!
          return nav.getBoundingClientRect().right <= 0 && !!nav.closest('[inert]')
        },
        null,
        { polling: 50 },
      )
      expect(await focused(page)).toBe('message')
      await ctx.close()
    })
    // as in iMessage: the keyboard goes once a finger drags down past the box into it, or taps the chat
    test(`a drag down into the keyboard or a tap on the chat lets the box go (${name})`, async () => {
      const { ctx, page, slide, still, refocus, x, box } = await chat(size)
      await slide([x, 300], [x, box.bottom + 12])
      await letsGo(page)
      await refocus()
      // the drag flung the message far below the screen, how far as fast as the finger went: back in view to tap it
      // (a tap off the screen goes nowhere, or now and then somewhere)
      await page.$eval('[data-msg="long-agent"] [data-anchor]', (b) => b.scrollIntoView({ block: 'center' }))
      await still()
      const words = (await page.$eval('[data-msg="long-agent"] [data-anchor]', (b) => b.getBoundingClientRect().toJSON())) as Box
      expect(words.top + 14).toBeGreaterThan(0)
      expect(words.top + 14).toBeLessThan(box.top)
      await page.touchscreen.tap(words.left + 40, words.top + 14)
      await letsGo(page)
      await ctx.close()
    })
  }
  test("a long message in a phone's box keeps its big round buttons, round in the corners", async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.goto(url())
    const text = page.locator('textarea[name=message]').first()
    await text.waitFor()
    await text.fill('One\nTwo\nThree')
    await page.waitForTimeout(50)
    const r = await page.evaluate(() => {
      const box = document.querySelector('[data-composer]')!
      const rect = (el: Element) => el.getBoundingClientRect()
      const send = rect(box.querySelector('button[aria-label=Send]')!)
      return { send: send.height, under: rect(box).bottom - send.bottom, tall: rect(box).height, radius: parseFloat(getComputedStyle(box).borderTopLeftRadius) }
    })
    expect(r.send).toBe(44)
    expect(r.tall).toBeGreaterThan(80)
    // 6px padding round a 44px button, so the corner radius is 6 + 44 / 2: the corner curves around the button
    expect(r.under).toBe(6)
    expect(r.radius).toBe(28)
    await page.close()
  })
  test('a picture growing the chat as it scrolls down keeps it on the newest message, with no arrow over it', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.goto(url())
    await page.waitForSelector('[data-msg="short-agent"]')
    await page.waitForTimeout(300)
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const list = () => document.querySelector('[data-msg]')!.closest('.overflow-y-auto') as HTMLElement
    // a little up from the bottom (still following it), then on its way down as a picture loads and grows the list
    await page.evaluate(
      async ([f, l]) => {
        const frames = eval(f) as () => Promise<void>
        const el = (eval(l) as () => HTMLElement)()
        el.scrollTop = el.scrollHeight - el.clientHeight - 40
        await frames()
        // the picture grows just before the chat hears of the scroll (as a slow one does, between two frames)
        const grow = () => {
          const grown = document.createElement('div')
          grown.style.height = '300px'
          el.firstElementChild!.appendChild(grown)
        }
        document.addEventListener('scroll', grow, { capture: true, once: true })
        el.scrollTop += 20
        await frames()
        await frames()
      },
      [frames.toString(), list.toString()],
    )
    const left = await page.evaluate((l) => {
      const el = (eval(l) as () => HTMLElement)()
      return el.scrollHeight - el.scrollTop - el.clientHeight
    }, list.toString())
    expect(left).toBeLessThan(2)
    expect(await page.$('button[aria-label$="to the latest"]')).toBeNull()
    await page.close()
  })
  test('a desktop still sends on Enter, and the jump to the latest sits in the middle', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url())
    const text = page.locator('textarea[name=message]').first()
    await text.waitFor()
    await page.waitForSelector('[data-msg="short-agent"]')
    await text.click()
    await text.fill('Ship it')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => !(document.querySelector('textarea[name=message]') as HTMLTextAreaElement).value)
    expect(await focused(page)).toBe('message')
    await page.$eval('[data-msg="tall-agent"] button[aria-expanded=false]', (b) => (b as HTMLElement).click())
    await page.$eval('[data-msg="tall-agent"]', (m) => m.scrollIntoView({ block: 'start' }))
    const jump = page.getByRole('button', { name: /jump to the latest/i })
    await jump.waitFor()
    const [j, list] = await Promise.all([
      jump.boundingBox(),
      page.locator('[data-msg]').first().locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]').boundingBox(),
    ])
    expect(Math.abs(j!.x + j!.width / 2 - (list!.x + list!.width / 2))).toBeLessThan(1)
    await page.close()
  })
})
