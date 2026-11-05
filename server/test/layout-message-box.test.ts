import { browser, server, url } from './layout-message-box-fixture.ts'
import { describe, expect, test } from 'bun:test'
import { settled, type Box } from './layout.ts'

describe.skipIf(!browser)('files in the message box', () => {
  /** a small PNG: a 2x2 picture */
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64')
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1280, height: 800 }],
  ] as const)
    test(`pictures are thumbnails and the row scrolls on its own (${name})`, async () => {
      const page = await browser!.newPage({ viewport, hasTouch: name === 'phone' })
      await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home`)
      await page.getByRole('button', { name: 'Attach files and more' }).click()
      const files = [
        ...Array.from({ length: 7 }, (_, i) => ({ name: `shot${i}.png`, mimeType: 'image/png', buffer: png })),
        { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') },
      ]
      await page.setInputFiles('input[name="file"]', files)
      const row = page.getByRole('list', { name: 'Attached files' })
      await row.getByRole('listitem').nth(7).waitFor()
      // every picture loaded as a thumbnail; the PDF is a tile with its name
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[aria-label="Attached files"] img')].every((i) => (i as HTMLImageElement).naturalWidth > 0),
      )
      expect(await row.locator('img').count()).toBe(7)
      await expect(row.getByText('notes.pdf')).toBeTruthy()
      // more than fit: the row scrolls sideways, the page doesn't, and the message box stays put
      const box = page.getByRole('textbox', { name: /Message/ })
      const before = await box.boundingBox()
      const sizes = await row.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, page: document.scrollingElement!.scrollWidth }))
      expect(sizes.scroll).toBeGreaterThan(sizes.client)
      expect(sizes.page).toBeLessThanOrEqual(viewport.width)
      await row.evaluate((el) => {
        el.style.scrollBehavior = 'auto'
        el.scrollLeft = 0
      })
      expect(await box.boundingBox()).toEqual(before)
      // taking one out keeps the box focused (the keyboard stays up) and nothing else changes
      await box.focus()
      await row.getByRole('button', { name: 'Remove shot0.png' }).click()
      expect(await row.getByRole('listitem').count()).toBe(7)
      expect(await box.evaluate((el) => el === document.activeElement)).toBe(true)
      // a tap on a thumbnail opens it full screen; Close brings the box back
      await row.getByRole('button', { name: 'Open shot1.png' }).click()
      const viewer = page.getByRole('dialog', { name: 'shot1.png' })
      await viewer.waitFor()
      expect(
        await viewer.getByRole('img', { name: 'shot1.png' }).evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0),
      ).toBe(true)
      await viewer.getByRole('button', { name: 'Close' }).click()
      await viewer.waitFor({ state: 'detached' })
      expect(await row.getByRole('listitem').count()).toBe(7)
      await page.close()
    })

  test('pasting pictures attaches them; pasting text stays text (phone)', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(url())
    const box = page.getByRole('textbox', { name: /Message/ })
    await box.focus()
    const b64 = png.toString('base64')
    // two clipboard screenshots with no real names, as Cmd+V or Paste on an iPhone brings them
    const kept = await box.evaluate((el, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }))
      dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }))
      return el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, b64)
    expect(kept).toBe(false)
    const row = page.getByRole('list', { name: 'Attached files' })
    await row.getByRole('listitem').nth(1).waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Attached files"] img')].every((i) => (i as HTMLImageElement).naturalWidth > 0))
    const names = await row.locator('img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('alt')))
    expect(names).toHaveLength(2)
    for (const n of names) expect(n).toMatch(/^screenshot-\d{4}-\d\d-\d\d-\d{6}-[12]\.png$/)
    // each comes out with its x, like a file from +
    await row.getByRole('button', { name: `Remove ${names[0]}` }).click()
    expect(await row.getByRole('listitem').count()).toBe(1)
    // plain text is left to the browser to paste as usual
    const text = await box.evaluate((el) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', 'hello')
      return el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    expect(text).toBe(true)
    expect(await row.getByRole('listitem').count()).toBe(1)
    await ctx.close()
  })

  test('files dragged onto the chat show a quiet highlight and attach on drop (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url())
    await page.getByRole('textbox', { name: /Message/ }).waitFor()
    const b64 = png.toString('base64')
    const dt = await page.evaluateHandle((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], 'diagram.png', { type: 'image/png' }))
      dt.items.add(new File(['%PDF'], 'spec.pdf', { type: 'application/pdf' }))
      return dt
    }, b64)
    const target = page.locator('[data-msg]').first()
    await target.dispatchEvent('dragenter', { dataTransfer: dt })
    const note = page.getByRole('status').filter({ hasText: 'Drop to attach' })
    await note.waitFor()
    // crossing into a child and back out doesn't drop the highlight
    await page.locator('[data-composer]').first().dispatchEvent('dragenter', { dataTransfer: dt })
    await target.dispatchEvent('dragleave', { dataTransfer: dt })
    expect(await note.count()).toBe(1)
    await target.dispatchEvent('dragover', { dataTransfer: dt })
    await target.dispatchEvent('drop', { dataTransfer: dt })
    await note.waitFor({ state: 'detached' })
    const row = page.getByRole('list', { name: 'Attached files' })
    await row.getByRole('listitem').nth(1).waitFor()
    expect(await row.getByRole('button', { name: 'Open diagram.png' }).count()).toBe(1)
    expect(await row.getByText('spec.pdf').count()).toBe(1)
    // a drag that leaves without dropping takes the highlight with it
    await target.dispatchEvent('dragenter', { dataTransfer: dt })
    await note.waitFor()
    await target.dispatchEvent('dragleave', { dataTransfer: dt })
    await note.waitFor({ state: 'detached' })
    await page.close()
  })
})

describe.skipIf(!browser)('pictures sent in the chat', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64')
  for (const [name, viewport, count, tile] of [
    ['phone', { width: 390, height: 844 }, 5, 88],
    ['desktop', { width: 1280, height: 800 }, 8, 84],
  ] as const)
    test(`sit side by side as small tiles and open in a viewer that pages through them (${name})`, async () => {
      const page = await browser!.newPage({ viewport, hasTouch: name === 'phone' })
      await page.goto(url())
      await page.getByRole('button', { name: 'Attach files and more' }).click()
      const names = Array.from({ length: count }, (_, i) => `${name}-pic${i}.png`)
      await page.setInputFiles(
        'input[name="file"]',
        names.map((n) => ({ name: n, mimeType: 'image/png', buffer: png })),
      )
      await page
        .getByRole('list', { name: 'Attached files' })
        .getByRole('listitem')
        .nth(count - 1)
        .waitFor()
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[aria-label="Attached files"] img')].every((i) => (i as HTMLImageElement).naturalWidth > 0),
      )
      await page.getByRole('button', { name: 'Send' }).click()
      const album = page.getByRole('group', { name: `${count} pictures` }).last()
      await album.waitFor()
      await page.waitForFunction(
        (n) => [...document.querySelectorAll(`[aria-label="${n} pictures"] img`)].every((i) => (i as HTMLImageElement).naturalWidth > 0),
        count,
      )
      // once it has risen into place
      await settled(page)
      // small tiles, about the size of the ones in the message box, in rows of up to three
      const boxes = await album.locator('[data-msg]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as Box & { height: number }))
      expect(boxes).toHaveLength(Math.min(count, 6))
      for (const b of boxes) expect(Math.round(b.height)).toBe(tile)
      expect(new Set(boxes.slice(0, 3).map((b) => Math.round(b.top))).size).toBe(1)
      expect(new Set(boxes.slice(3).map((b) => Math.round(b.top))).size).toBe(1)
      expect(boxes[3].top).toBeGreaterThan(boxes[0].bottom)
      // the rows line up on the right, like your bubbles, and stay on screen
      expect(Math.round(boxes[2].right)).toBe(Math.round(boxes.at(-1)!.right))
      for (const b of boxes) expect(b.right).toBeLessThanOrEqual(viewport.width)
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(viewport.width)
      // past six, the sixth tile counts every picture not shown
      if (count > 6) {
        const last = album.getByRole('button', { name: `Open ${names[5]} and ${count - 6} more` })
        expect(await last.textContent()).toBe(`+${count - 5}`)
      }
      // a tap opens it full screen, with where it is among the chat's pictures
      await album.getByRole('button', { name: `Open ${names[1]}` }).click()
      let viewer = page.getByRole('dialog', { name: names[1] })
      await viewer.waitFor()
      const [, at, of] = (await viewer.getByText(/^\d+ of \d+$/).textContent())!.match(/^(\d+) of (\d+)$/)!.map(Number)
      expect(of).toBeGreaterThanOrEqual(count)
      if (name === 'desktop') {
        // the arrow keys and the round arrows page through them; Esc closes
        await page.keyboard.press('ArrowRight')
        viewer = page.getByRole('dialog', { name: names[2] })
        await viewer.waitFor()
        expect(await viewer.getByText(`${at + 1} of ${of}`).count()).toBe(1)
        await viewer.getByRole('button', { name: 'Previous picture' }).click()
        await page.getByRole('dialog', { name: names[1] }).waitFor()
        await page.keyboard.press('Escape')
        await page.getByRole('dialog').waitFor({ state: 'detached' })
        // closed in the middle of a slide, it stays closed
        await album.getByRole('button', { name: `Open ${names[1]}` }).click()
        await page.getByRole('dialog', { name: names[1] }).waitFor()
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('Escape')
        await page.getByRole('dialog').waitFor({ state: 'detached' })
        await page.waitForTimeout(400)
        expect(await page.getByRole('dialog').count()).toBe(0)
      } else {
        // a swipe across goes to the next one
        const box = (await viewer.boundingBox())!
        await page.mouse.move(box.width / 2 + 100, box.height / 2)
        await page.mouse.down()
        for (let x = 100; x >= -100; x -= 25) await page.mouse.move(box.width / 2 + x, box.height / 2)
        await page.mouse.up()
        viewer = page.getByRole('dialog', { name: names[2] })
        await viewer.waitFor()
        // a reaction from the viewer lands in that tile's corner
        await viewer.getByRole('button', { name: 'React 👍' }).click()
        await viewer.getByRole('button', { name: 'Close' }).click()
        await viewer.waitFor({ state: 'detached' })
        const tile = album.locator('[data-msg]').nth(2)
        const pill = tile.getByRole('button', { name: '👍 from you' })
        await pill.waitFor()
        const [t, p] = [(await tile.boundingBox())!, (await pill.boundingBox())!]
        expect(p.x).toBeGreaterThanOrEqual(t.x)
        expect(p.x + p.width).toBeLessThanOrEqual(t.x + t.width)
        expect(p.y + p.height).toBeLessThanOrEqual(t.y + t.height)
      }
      await page.close()
    })
})

describe.skipIf(!browser)('a picture that cannot be shown', () => {
  test('is a file tile that keeps its reactions and ways to react (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url())
    const msg = page.locator('[data-msg="heic-you"]')
    await msg.getByRole('link', { name: 'Download photo.heic' }).waitFor()
    // its reaction stays on its corner, and tapping it adds yours
    const pill = msg.getByRole('button', { name: '👍 from agent' })
    await pill.waitFor()
    const [tile, p] = [(await msg.locator('[data-anchor]').boundingBox())!, (await pill.boundingBox())!]
    expect(p.y).toBeLessThan(tile.y + tile.height)
    expect(p.y + p.height).toBeGreaterThan(tile.y + tile.height)
    // the smiley beside it opens the bar
    await msg.locator('[data-anchor]').hover()
    await msg.getByRole('button', { name: 'React to photo.heic' }).click()
    await page.waitForSelector('[role=dialog][aria-label=React]', { state: 'visible' })
    await page.close()
  })

  test('in an album, a hold on its tile reacts instead of downloading it (phone)', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    let downloads = 0
    page.on('download', () => downloads++)
    await page.goto(url())
    const tile = page.locator('[data-msg="heic-a"] [data-anchor]')
    await page.getByRole('group', { name: '2 pictures' }).getByRole('link', { name: 'Download a.heic' }).waitFor()
    await tile.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    const b = (await tile.boundingBox())!
    const cdp = await ctx.newCDPSession(page)
    const [x, y] = [b.x + b.width / 2, b.y + b.height / 2]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await page.waitForTimeout(600)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForSelector('[role=dialog][aria-label=React]', { state: 'visible' })
    await page.getByRole('button', { name: 'React 👍' }).first().tap()
    await page.locator('[data-msg="heic-a"]').getByRole('button', { name: '👍 from you' }).waitFor()
    expect(downloads).toBe(0)
    await ctx.close()
  })
})
