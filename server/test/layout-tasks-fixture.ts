import type { Page } from 'playwright-core'
import { layout } from './layout.ts'

export const { browser, world, server, url } = await layout({ everything: true })

/** the Tasks list's headings (machines, groups), top to bottom, but Automations (and the sidebar's own) */
export const headings = (page: Page, within = '') =>
  page.$$eval(`${within}[data-heading]`, (els) =>
    els
      .filter((el) => !el.closest('#places, nav'))
      .map((el) => (el as HTMLElement).dataset.heading!)
      .filter((l) => l !== 'Automations'),
  )
export const pick = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Group tasks' }).click()
  await page.getByRole('menuitemradio', { name: new RegExp(`^${name}$`) }).click()
}
/** each task row's line under its title, by its id */
export const subs = (page: Page) =>
  page.$$eval('section[aria-label="Tasks"] li', (li) =>
    Object.fromEntries(li.map((l) => [l.textContent?.match(/^[A-Z]+-[A-Z0-9]+/)?.[0], l.querySelector('.text-xs\\/4')?.textContent ?? ''])),
  )

/** at mac's home space, the lists' chip is all of mac */
export function macChip() {
  localStorage.setItem('shepherdr.lists', JSON.stringify({ pinned: false, chips: ['m:mac'], at: 'p:mac:~' }))
}
