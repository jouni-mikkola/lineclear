import { layout } from './layout.ts'

export const { browser, world, server, url } = await layout()

/** adds vm-str's quiet project: nothing waits on you there and nothing is unread, so folding vm-str hides it (what has
 *  something in it stays in sight). Gives back a function that takes it away again */
export async function quietProject() {
  await world.addSpace({ machine: 'vm-str', path: '~/dev/quiet', create: true })
  return () => {
    world.places = world.places.filter((p) => p.id !== 'p:vm-str:quiet')
    world.emit('snapshot')
  }
}
