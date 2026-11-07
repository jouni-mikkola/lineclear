import { clock } from '../../shared/time.ts'
import { slugify, type Machine, type Place } from '../../shared/types.ts'
import type { Agents } from './agents.ts'
import type { Engine } from './engine/engine.ts'
import { room } from './herdr-forward.ts'
import type { Machines } from './machines.ts'
import { HOST, NAME, placeId, type Places } from './places.ts'

interface Parts {
  places: Places
  engine: Engine
  agents: Agents
  peers: Machines | null
  /** open coordinator questions by place */
  asks: Record<string, string>
  health: Machine['health']
}

/** every space and every machine, as the sidebar shows them: this machine's, then the others' as they last showed
 *  themselves (just after a start, while they connect, as before it), the names the human gave them */
export function listing({ places: own, engine, agents, peers: links, asks, health }: Parts): { places: Place[]; machines: Machine[] } {
  const status = (ids: string[], coord: string[]): Place['status'] => {
    const mine = engine.tasks.filter((t) => ids.includes(t.project) && !t.archived).map((t) => engine.statusOf(t))
    if (mine.includes('need') || ids.some((id) => asks[id])) return 'need'
    if (mine.includes('ready')) return 'ready'
    if (mine.includes('work') || mine.includes('merging') || coord.some((k) => agents.status(k) === 'working')) return 'work'
    return 'idle'
  }
  const peers = links?.list() ?? []
  const up = agents.reachable
  const gone = clock(agents.lastReach)
  const machines: Machine[] = [
    {
      id: placeId.machine(),
      machine: HOST,
      name: NAME,
      status: up ? 'idle' : 'off',
      unreachableSince: up ? undefined : gone,
      health,
      room: room(),
      herdrDown: up ? undefined : gone,
    },
  ]
  const places: Place[] = own.shown().map(({ id, name, space }) => ({
    id,
    name,
    machine: HOST,
    ...(space ? {} : { home: true }),
    // what its lists show: a home space its machine's, the main machine's every machine's
    level: space ? 2 : peers.length ? 0 : 1,
    status: space
      ? status([id], [id])
      : status(
          own.spaces.map((p) => placeId.space(p.name)),
          [id],
        ),
    chat: id,
    ...(space ? { githubRemote: !!space.github } : {}),
    // herdr gone: this machine's chats say so plainly
    ...(up ? {} : { herdrDown: gone }),
  }))
  for (const l of peers) {
    const m = l.snap?.machines?.find((x) => x.machine === l.rec.machine) ?? {
      id: placeId.machine(l.rec.machine),
      machine: l.rec.machine,
      name: l.rec.machine,
      status: 'idle' as const,
    }
    const away = !l.reachable ? (l.connecting ? { connecting: true } : { status: 'off' as const, unreachableSince: clock(l.down ?? l.rec.lastSeen) }) : {}
    machines.push({ ...m, ...away })
    // a machine never reached yet still has its home space, to come back to
    const theirs = l.snap?.places ?? [
      {
        id: placeId.home(l.rec.machine),
        name: 'home',
        machine: l.rec.machine,
        home: true,
        level: 1 as const,
        status: 'off' as const,
        chat: placeId.home(l.rec.machine),
      },
    ]
    for (const p of theirs) places.push({ ...p, ...(p.home ? { level: 1 as const } : {}), ...away })
  }
  // the names the human gave them: a space's by the space rules (another on its machine with it keeps its own)
  for (const m of machines) {
    if (own.names[m.id]) m.name = own.names[m.id]
    if (own.emojis[m.id]) m.emoji = own.emojis[m.id]
    else delete m.emoji
  }
  for (const p of places) {
    const want = own.names[p.id] && slugify(own.names[p.id])
    if (want && !places.some((x) => x !== p && x.machine === p.machine && x.name === want)) p.name = want
  }
  return { places, machines }
}
