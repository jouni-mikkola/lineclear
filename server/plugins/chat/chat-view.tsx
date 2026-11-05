import { useRef, useState, type ReactNode } from 'react'
import { chatName, registry, setUI, useStore, useUI } from '@client/kernel.ts'
import { FileIcon, ic, MenuItem, SearchIcon } from '@client/ui.tsx'
import { draggingFiles, dropped } from './paste.ts'
import { FindBar, openFind } from './find.tsx'
import { attach, Composer } from './chat-composer.tsx'
import { useChat } from './chat-bubbles.tsx'
import { StickToBottom } from './chat-attach.tsx'
import { Messages } from './chat-messages.tsx'

/** files dragged onto a chat attach to its message box; while they hover, the chat dims softly under a quiet note */
function DropFiles({ chatKey, children }: { chatKey: string; children: ReactNode }) {
  const [over, setOver] = useState(false)
  // enter and leave fire for every child the drag crosses: count them, so the highlight doesn't flicker
  const depth = useRef(0)
  return (
    <div
      data-drop
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (!draggingFiles(e.dataTransfer)) return
        e.preventDefault()
        depth.current++
        setOver(true)
      }}
      onDragOver={(e) => {
        if (!draggingFiles(e.dataTransfer)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        if (!draggingFiles(e.dataTransfer)) return
        if (--depth.current <= 0) {
          depth.current = 0
          setOver(false)
        }
      }}
      onDrop={(e) => {
        if (!draggingFiles(e.dataTransfer)) return
        e.preventDefault()
        depth.current = 0
        setOver(false)
        attach(chatKey, dropped(e.dataTransfer))
      }}
    >
      {children}
      {over ? (
        <div
          role="status"
          className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-box bg-bg/80 shadow-[inset_0_0_0_1.5px_var(--focus)] backdrop-blur-[2px]"
        >
          <span className="flex items-center gap-2 rounded-full bg-bubble px-3.5 py-2 text-fg2">
            <FileIcon className={ic} />
            Drop to attach
          </span>
        </div>
      ) : null}
    </div>
  )
}

/* ---------- the chat ---------- */

export function ChatView({ chatKey, placeholder, unreachable }: { chatKey: string; placeholder: string; unreachable?: string }) {
  const from = useStore((s) => chatName(s.snap!, chatKey))
  const chat = useChat(chatKey)
  const override = useUI((u) => registry.chatBody.find((b) => b.when(u, chatKey)))
  if (override) return <override.View chatKey={chatKey} />
  return (
    <DropFiles chatKey={chatKey}>
      <FindBar chatKey={chatKey} />
      <StickToBottom key={chatKey} chatKey={chatKey}>
        {unreachable ? (
          <div className="mx-auto w-full max-w-read px-5 pt-4">
            <div role="status" className="rounded-box bg-bubble px-3 py-2.5 text-[0.8125rem] text-pretty text-fg2 phone:text-[0.9375rem]">
              {unreachable}
            </div>
          </div>
        ) : null}
        <Messages chat={chat ?? { key: chatKey, cli: 'Claude Code', messages: [] }} from={from} />
      </StickToBottom>
      <Composer chatKey={chatKey} placeholder={placeholder} cli={chat?.cli ?? 'Claude Code'} />
    </DropFiles>
  )
}

/** Search in this chat, first in a chat's ⋯ menu (a coordinator's or a task's) */
export function FindItem({ chatKey }: { chatKey: string }) {
  return (
    <>
      <MenuItem icon={<SearchIcon className={ic} />} onClick={() => openFind(chatKey)}>
        Search in this chat
      </MenuItem>
      {registry.views.search ? (
        <MenuItem
          icon={<SearchIcon className={ic} />}
          onClick={() => setUI({ search: true, searchScope: { kind: 'chat', id: chatKey }, menu: false, taskMenu: false })}
        >
          Search this chat and beyond
        </MenuItem>
      ) : null}
    </>
  )
}
