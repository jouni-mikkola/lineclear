import { browser, world, server, url } from './layout-message-box-fixture.ts'
import { describe, expect, test } from 'bun:test'
import { startApp } from '../server/app.ts'
import { DemoWorld } from '../server/demo/world.ts'
import type { Source } from '../server/source.ts'
import type { Message } from '../shared/types.ts'
import { builtScreen } from './web.ts'

describe.skipIf(!browser)('typing in the message box', () => {
  // on a desktop the chat sits between places and tasks, which a phone doesn't draw
  test.each([
    ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
    ['desktop', { viewport: { width: 1600, height: 1000 } }],
  ] as const)('each letter redraws only the box: not the messages, the frame or the lists (%s)', async (_, size) => {
    const ctx = await browser!.newContext(size)
    // React tells a devtools hook about every commit: note the parts that ran, each by the element it draws (or sits in)
    await ctx.addInitScript(() => {
      const w = window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: object; drawn: Element[] | null }
      w.drawn = null
      type Fiber = { tag: number; flags: number; child: Fiber | null; sibling: Fiber | null; return: Fiber | null; alternate: Fiber | null; stateNode: unknown }
      const parts = new Set([0, 1, 11, 14, 15])
      const host = (f: Fiber) => {
        for (let c: Fiber | null = f; c; c = c.child) if (c.tag === 5) return c.stateNode as Element
        for (let r = f.return; r; r = r.return) if (r.tag === 5) return r.stateNode as Element
        return document.body
      }
      w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        renderers: new Map(),
        inject: () => 1,
        checkDCE: () => {},
        onScheduleFiberRoot: () => {},
        onCommitFiberUnmount: () => {},
        onPostCommitFiberRoot: () => {},
        onCommitFiberRoot: (_: number, root: { current: Fiber }) => {
          if (!w.drawn) return
          // as React's devtools do: a part ran if it did work this commit; a subtree it didn't touch keeps its children
          const stack: Fiber[] = [root.current]
          while (stack.length) {
            const f = stack.pop()!
            if (parts.has(f.tag) && f.alternate && f.flags & 1) w.drawn.push(host(f))
            if (f.alternate && f.child === f.alternate.child) continue
            for (let c = f.child; c; c = c.sibling) stack.push(c)
          }
        },
      }
    })
    const page = await ctx.newPage()
    await page.goto(url())
    const box = page.locator('textarea[name=message]')
    await box.waitFor()
    await page.waitForFunction(() => document.querySelectorAll('[data-messages] [data-msg]').length >= 6)
    await box.click()
    await page.waitForTimeout(300)
    await page.evaluate(() => ((window as unknown as { drawn: Element[] }).drawn = []))
    await box.pressSequentially('Run the tests', { delay: 20 })
    await page.waitForTimeout(200)
    const out = await page.evaluate(() => {
      const drawn = (window as unknown as { drawn: Element[] }).drawn
      const composer = document.querySelector('[data-composer]')!.parentElement!
      const say = (el: Element) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`
      return {
        n: drawn.length,
        messages: drawn.filter((el) => el.closest('[data-messages]')).map(say),
        outside: [...new Set(drawn.filter((el) => !composer.contains(el)).map(say))],
      }
    })
    expect(await box.inputValue()).toBe('Run the tests')
    // the box itself redrew, letter by letter
    expect(out.n).toBeGreaterThanOrEqual(13)
    expect(out.messages).toEqual([])
    expect(out.outside).toEqual([])
    await box.fill('')
    await ctx.close()
  })
})

describe.skipIf(!browser)('typing in the message box, continued', () => {
  test('in a long chat on a desktop, a letter costs a few ms of layout, not a pass over every message', async () => {
    // a coordinator's chat after a long day, of its own so the other tests keep their chats
    const long = new DemoWorld()
    const gtm = long.places.find((p) => p.name === 'gtm')!
    const now = Date.now()
    long.chats[gtm.chat].messages.unshift(
      ...Array.from(
        { length: 400 },
        (_, i): Message => ({
          id: `long-${i}`,
          who: i % 2 ? 'agent' : 'you',
          text: i % 2 ? `A reply with **bold**, \`code\` and a [link](https://example.com), number ${i}.\n\n- one\n- two` : `Question number ${i}`,
          at: now - (400 - i) * 60_000,
        }),
      ),
    )
    const app = startApp({ source: long as unknown as Source, dist: await builtScreen(), port: 0 })
    const ctx = await browser!.newContext({ viewport: { width: 1600, height: 1000 } })
    const page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)
    await page.goto(`http://127.0.0.1:${app.port}/?place=${encodeURIComponent(gtm.id)}`)
    const box = page.locator('textarea[name=message]')
    await box.waitFor()
    await page.waitForFunction(() => document.querySelectorAll('[data-messages] [data-msg]').length >= 400)
    // places and tasks show beside the chat
    expect(await page.locator('#places').isVisible()).toBe(true)
    await box.click()
    await page.waitForTimeout(300)
    const text = 'Run the tests and tell me'
    await box.pressSequentially(text, { delay: 30 })
    await page.waitForTimeout(200)
    expect(await box.inputValue()).toBe(text)
    // the box grows with its words inside a grid row of a fixed height: the columns beside it (and the 400 messages
    // above it) aren't measured again. It was 30 ms and more a letter when the row sized itself to its content.
    // No letter restyles or lays out more than a few dozen of the page's 11,000 elements. Counted, not timed: a
    // busy runner takes twice as long over the same work (10 ms of script and style a letter on CI, 6 here). The
    // first key once restyled them all, for the keyboard's rings (data-keys on <html>)
    await box.fill('')
    await box.click()
    // (a trace holds every page of the browser, and other test files' pages work in it meanwhile: only this one's)
    const frame = (await cdp.send('Page.getFrameTree')).frameTree.frame.id
    const events: { name: string; args?: { elementCount?: number; beginData?: { frame?: string; dirtyObjects?: number } } }[] = []
    cdp.on('Tracing.dataCollected', (e) => events.push(...(e.value as unknown as typeof events)))
    const traced = new Promise((done) => cdp.once('Tracing.tracingComplete', done))
    await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['devtools.timeline'] }, transferMode: 'ReportEvents' })
    await box.pressSequentially(text, { delay: 30 })
    await page.waitForTimeout(200)
    await cdp.send('Tracing.end')
    await traced
    expect(await box.inputValue()).toBe(text)
    const most = (name: string, n: (e: (typeof events)[number]) => number | undefined) =>
      Math.max(...events.filter((e) => e.name === name && e.args?.beginData?.frame === frame).map((e) => n(e) ?? 0))
    expect(most('UpdateLayoutTree', (e) => e.args?.elementCount)).toBeGreaterThan(0)
    expect(most('UpdateLayoutTree', (e) => e.args?.elementCount)).toBeLessThan(200)
    expect(most('Layout', (e) => e.args?.beginData?.dirtyObjects)).toBeGreaterThan(0)
    expect(most('Layout', (e) => e.args?.beginData?.dirtyObjects)).toBeLessThan(200)
    await ctx.close()
    app.stop(true)
  })

  test('each chat keeps its own half-typed words, and they come back after a reload', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 844 } })
    const base = `http://127.0.0.1:${server!.port}/`
    const machine = world.snapshot().places.find((p) => p.id === 'p:mac:~')!
    await page.goto(`${base}?place=${encodeURIComponent(machine.id)}`)
    const box = page.locator('textarea[name=message]').first()
    await box.waitFor()
    // a new page load: what the reload on a new build keeps, as it keeps it
    await page.evaluate(() => sessionStorage.setItem('shepherdr.kept', JSON.stringify({ text: { 'p:vm-str:~': 'half a thought' } })))
    await page.goto(`${base}?place=vm-str/home`)
    expect(await box.inputValue()).toBe('half a thought')
    await page.evaluate((id) => {
      history.pushState(null, '', `?place=${encodeURIComponent(id)}`)
      dispatchEvent(new PopStateEvent('popstate'))
    }, machine.id)
    await page.waitForFunction(() => (document.querySelector('textarea[name=message]') as HTMLTextAreaElement)?.dataset.chat !== 'p:vm-str:~')
    expect(await box.inputValue()).toBe('')
    await page.goBack()
    await page.waitForFunction(() => (document.querySelector('textarea[name=message]') as HTMLTextAreaElement)?.dataset.chat === 'p:vm-str:~')
    expect(await box.inputValue()).toBe('half a thought')
    await box.fill('')
    await page.close()
  })
})
