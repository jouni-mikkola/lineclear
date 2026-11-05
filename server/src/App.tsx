import clsx from 'clsx'
import { registry, setUI, useSnap, useUI } from './kernel.ts'
import { PanelSheet } from './Panel.tsx'
import { useKeyboard, Loading } from './App-Sidebar.tsx'
import { PhoneLayout } from './App-part1.tsx'
import { WideLayout } from './App-Panes.tsx'
export {} from './App-Sidebar.tsx'

export default function App() {
  const snap = useSnap()
  const device = useUI((u) => u.device)
  const search = useUI((u) => u.search)
  const keyboard = useUI((u) => u.keyboard)
  useKeyboard()
  if (!snap) return <Loading />
  return (
    // sideways swipes go to the app (the drawer, going back); up and down scroll as the browser does. Wider than a phone, the app
    // keeps clear of the notch, the rounded corners and the home bar
    <div
      data-device={device}
      className={clsx(
        'isolate flex h-full touch-pan-y touch-pinch-zoom flex-col overflow-hidden bg-bg font-sans text-sm/5 antialiased phone:text-base/6',
        device !== 'phone' && 'pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]',
        device !== 'phone' && !keyboard && 'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      {registry.topBars.map((Bar, i) => (
        <Bar key={i} />
      ))}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {device === 'phone' ? <PhoneLayout snap={snap} /> : <WideLayout snap={snap} />}
        <PanelSheet />
        {registry.overlays.map((O, i) => (
          <O key={i} />
        ))}
        {search && registry.views.search ? <registry.views.search onClose={() => setUI({ search: false })} /> : null}
      </div>
    </div>
  )
}
