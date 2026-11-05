import { definePlugin } from '@client/kernel.ts'
import { DiffIcon, FolderIcon, PrIcon } from '@client/ui.tsx'
import { mergedOff, DiffView, usePrOff, PrView } from './worktree-patch.tsx'
import { FilesView } from './worktree-files.tsx'
export { treeOf } from './worktree-files.tsx'
export { patchLines } from './worktree-patch.tsx'

export default definePlugin({
  name: 'worktree',
  setup(reg) {
    reg.taskPanel.push(
      { id: 'files', order: 20, label: 'Files', Icon: FolderIcon, useOff: mergedOff, View: FilesView },
      { id: 'diff', order: 30, label: 'Diff', Icon: DiffIcon, useOff: mergedOff, View: DiffView },
      { id: 'pr', order: 40, label: 'Pull request', Icon: PrIcon, useOff: usePrOff, View: PrView },
    )
  },
})
