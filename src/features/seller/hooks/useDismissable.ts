import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Open/close state for a popover that dismisses on outside click or Escape.
 *
 * Shared by the profile menu and the per-row action menus so both behave identically — including
 * returning focus to the trigger, which is what makes a menu usable from the keyboard.
 */
export function useDismissable<T extends HTMLElement>(initial = false) {
  const [open, setOpen] = useState(initial)
  const ref = useRef<T>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  const toggle = useCallback(() => setOpen((value) => !value), [])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target
      if (target instanceof Node && ref.current && !ref.current.contains(target)) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return { open, setOpen, toggle, close, ref, triggerRef }
}
