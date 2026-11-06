import { Dialog } from "@base-ui/react/dialog";
import { MonthSpendView, SpendChart, UsageChart } from "../kit/index.ts";
import type { HomeData } from "./data.ts";

// The sheet behind Home's usage mark, in its own file so the first script does not carry the charts.

export function UsageSheet({ d, open, onClose }: { d?: HomeData; open: boolean; onClose: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-base/80" />
        <Dialog.Popup
          className="fixed inset-x-3 top-[5vh] z-50 mx-auto max-h-[90vh] max-w-[720px] overflow-y-auto rounded-lg border border-line2 bg-raised p-5 outline-none md:p-8"
          data-usage-sheet
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <Dialog.Title className="text-sm font-medium text-fg3">Usage</Dialog.Title>
            <Dialog.Close className="min-h-9 shrink-0 rounded-sm bg-raised2 px-3 text-fg hover:bg-raised3 focus-visible:outline-2 focus-visible:outline-accent">
              Close
            </Dialog.Close>
          </div>
          <div className="grid gap-6">
            <UsageChart usage={d?.usage ?? []} moves={d?.moves} />
            {d?.month && <MonthSpendView month={d.month} />}
            <SpendChart spend={d?.spend ?? []} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
