// Terminal menus: arrow and y/n prompts must parse before a session log exists.
import { describe, expect, test } from 'bun:test'
import { menuId, menuKeys, parseMenu } from '../server/live/chats.ts'

describe('terminal menus', () => {
  test('generic arrow and y/n menus; ordinary input is not a menu', () => {
    expect(parseMenu('Choose provider\n❯ Local\n  Hosted\nEnter to select · ↑/↓ to navigate')?.choices).toEqual(['Local', 'Hosted'])
    expect(parseMenu('Choose\n❯ Allow once\n  Allow always\n  Cancel\nEnter to confirm')?.choices).toEqual(['Allow once', 'Allow always', 'Cancel'])
    const yn = parseMenu('Allow this tool? [y/N]')!
    expect(menuKeys(yn, 1)).toEqual(['n', 'enter'])
    expect(parseMenu('❯ Try fixing a bug\n  permissions on')).toBeNull()
    expect(menuKeys(yn, -1)).toBeUndefined()
    expect(menuKeys(yn, 12)).toBeUndefined()
  })
  test('a changed permission gets a new identity; a cursor move does not', () => {
    const m = parseMenu('Allow? [y/n]')!
    expect(menuId('c', m)).toBe(menuId('c', { ...m, cursor: 1 }))
    expect(menuId('c', m)).not.toBe(menuId('c', { ...m, screen: 'Delete files? [y/n]' }))
  })
})
