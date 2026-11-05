// A task's side panel, the Browser item: watching the agent, taking over, and when it won't start.
import { describe, expect, test } from 'bun:test'
import type { Page } from 'playwright-core'
import { Browsers, browserEnv } from '../server/live/browser.ts'
import { fakeAgentBrowser } from './fake-agent-browser.ts'
import { layout } from './layout.ts'

const { browser, world, server } = await layout()

describe.skipIf(!browser)("a task's side panel: the Browser item", () => {
  const task = (id: string) => `http://127.0.0.1:${server!.port}/?place=p:vm-str:gtm&task=${id}`
  const _width = (page: Page, sel: string) => page.$eval(sel, (el) => Math.round(el.getBoundingClientRect().width))

  test('the Browser item, where the task’s machine has no browser, is greyed with what to do', async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    await page.goto(task('GTM-15'))
    await page.getByRole('button', { name: 'Show task panel' }).click()
    await page.getByRole('tab', { name: 'Browser' }).click()
    await page.getByText('The demo has no browser: start it with LINECLEAR_DEMO_BROWSER=1.').waitFor()
    expect(await page.getByRole('application').count()).toBe(0)
    await page.close()
  })

  /** a frame of a page, as the fake agent-browser streams it */
  const jpegOf = async (html: string) => {
    const paint = await browser!.newPage({ viewport: { width: 640, height: 360 } })
    await paint.setContent(html)
    const jpeg = (await paint.screenshot({ type: 'jpeg' })).toString('base64')
    await paint.close()
    return jpeg
  }
  /** the world's browsers swapped for ones driving a fake agent-browser; the caller puts `was` back */
  const fakeBrowsers = () => {
    const fake = fakeAgentBrowser()
    const was = world.browsers
    const b = new Browsers({
      bin: fake.bin,
      env: (t) => ({ ...browserEnv(t), AGENT_BROWSER_NAMESPACE: 'layout-test', ...fake.env }),
      host: 'vm-str',
      user: () => 'Elias',
      working: () => false,
      tell: () => undefined,
    })
    world.browsers = b
    const until = async (f: () => boolean) => {
      for (let i = 0; !f(); i++) {
        if (i > 2400) throw new Error('timed out')
        await new Promise((r) => setTimeout(r, 25))
      }
    }
    return { fake, was, b, until }
  }

  test('the Browser panel: watch the agent, take over and click, mark it up with a pin, send the note into the chat', async () => {
    const { fake, was, b, until } = fakeBrowsers()
    try {
      await until(() => b.status().ready)
      // a frame of the page: any picture will do
      const jpeg = await jpegOf('<body style="margin:0;background:#2563eb"><h1 style="color:white;margin:40px">Settings</h1></body>')
      const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
      await page.goto(task('GTM-15'))
      await page.getByRole('button', { name: 'Show task panel' }).click()
      await page.getByRole('tab', { name: 'Browser' }).click()
      await until(() => fake.streamSocks.size > 0)
      fake.toPanels({ type: 'frame', seq: 1, data: jpeg, metadata: { deviceWidth: 1280, deviceHeight: 720, scrollOffsetX: 0, scrollOffsetY: 0 } })
      await page.getByText('Agent is driving').waitFor()
      const stage = page.getByRole('application')
      // the agent drives: a click goes nowhere
      await stage.click()
      await page.getByText('Take over to use the page').waitFor()
      expect(fake.fromPanel).toEqual([])
      await page.getByRole('button', { name: 'Take over' }).click()
      await page.getByText('You’re driving').waitFor()
      await stage.click()
      await until(() => fake.fromPanel.some((m) => m.type === 'input_mouse' && m.eventType === 'mousePressed'))
      expect(fake.fromPanel.find((m) => m.eventType === 'mousePressed')).toMatchObject({ x: 640, y: 360, button: 'left' })
      // Mark up: a tap is a note, with its pin, not a click
      await page.getByRole('button', { name: /^Mark up/ }).click()
      const clicks = fake.fromPanel.length
      await stage.click()
      const note = page.getByRole('textbox', { name: 'Note 1' })
      await note.fill('Make it say “Save changes”')
      await note.press('Enter')
      await page.getByText('Make it say “Save changes”').waitFor()
      expect(await stage.getByText('1', { exact: true }).count()).toBe(1)
      expect(fake.fromPanel.slice(clicks).filter((m) => m.type === 'input_mouse' && m.eventType !== 'mouseMoved')).toEqual([])
      await page.getByRole('button', { name: 'Send 1 note to the agent' }).click()
      await page.getByText('1 note sent to the agent.').waitFor()
      const sent = world.chats['GTM-15/Agent'].messages.at(-1)
      expect(sent?.text).toBe('Notes in the browser on localhost:5173/settings:\n1. button "Save": Make it say “Save changes”')
      await page.close()
    } finally {
      await b.close('GTM-15')
      world.browsers = was
      fake.stop()
    }
  })
  test('the Browser panel when it won’t start: the message covers the last page in the theme’s colours (no white box in dark), and Try again starts it', async () => {
    const { fake, was, b, until } = fakeBrowsers()
    try {
      await until(() => b.status().ready)
      // a white page, as most are
      const white = await jpegOf('<body style="background:#fff"></body>')
      const frame = () =>
        fake.toPanels({ type: 'frame', seq: 1, data: white, metadata: { deviceWidth: 1280, deviceHeight: 720, scrollOffsetX: 0, scrollOffsetY: 0 } })
      const page = await browser!.newPage({ viewport: { width: 1600, height: 900 }, colorScheme: 'dark' })
      await page.goto(task('GTM-15'))
      const toggle = page.getByRole('button', { name: 'Show task panel' })
      if (await toggle.count()) await toggle.click()
      await page.getByRole('tab', { name: 'Browser' }).click()
      await until(() => fake.streamSocks.size > 0)
      frame()
      await page.getByText('Agent is driving').waitFor()
      // another agent-browser takes the session's daemon: the stream goes, and starting again fails
      fake.state({ clash: 99 })
      fake.streamSocks.forEach((s) => s.close())
      const why = page.getByText(/^Another agent-browser/)
      await why.waitFor({ timeout: 60_000 })
      const cover = why.locator('xpath=../..')
      const bg = await cover.evaluate((e) => getComputedStyle(e).backgroundColor)
      expect(bg).not.toBe('rgba(0, 0, 0, 0)')
      expect(bg).not.toBe('rgb(255, 255, 255)')
      expect(bg).toBe(await page.getByRole('application').evaluate((e) => getComputedStyle(e).backgroundColor))
      // fixed meanwhile: Try again starts it, with no stale error left
      fake.state()
      await page.getByRole('button', { name: 'Try again' }).click()
      await until(() => fake.streamSocks.size > 0)
      frame()
      await why.waitFor({ state: 'detached' })
      expect(await page.getByRole('button', { name: 'Try again' }).count()).toBe(0)
      await page.close()
    } finally {
      await b.close('GTM-15')
      world.browsers = was
      fake.stop()
    }
  })
})
