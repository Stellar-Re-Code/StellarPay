'use client'

/**
 * Accessible modal dialog: traps focus on the panel, closes on Esc / backdrop
 * click, restores focus to the trigger on close, and labels itself for screen
 * readers.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Set false to prevent closing while a transaction is in flight. */
  dismissible?: boolean
}

export default function Modal({ open, onClose, title, children, dismissible = true }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    // Move focus into the dialog.
    const focusable = panel?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    focusable?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && dismissible) {
        e.preventDefault()
        onClose()
      }
      if (e.key === 'Tab' && panel) {
        const nodes = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute('disabled'))
        if (nodes.length === 0) return
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused.current?.focus()
    }
  }, [open, onClose, dismissible])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose()
      }}
    >
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 w-full max-w-lg rounded-2xl border border-stellar-border bg-stellar-surface p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}
