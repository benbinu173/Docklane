import { useEffect, useState } from 'react'

export function useDebounced<T>(value: T, delay = 250) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}
export function useBoundedRefresh() {
  const [opened] = useState(() => Date.now())
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    let mounted = true
    const update = () => {
      if (!mounted) return
      const editing = document.activeElement?.matches(
        'input, textarea, select, [contenteditable="true"]',
      )
      setAllowed(
        Date.now() - opened < 120_000 &&
          !document.hidden &&
          !editing &&
          !document.querySelector('[role="dialog"]'),
      )
    }
    // Focusout fires before the next element becomes active.
    const afterFocus = () => queueMicrotask(update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', afterFocus)
    document.addEventListener('visibilitychange', update)
    const dialogs = new MutationObserver(update)
    dialogs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role'],
    })
    const deadline = setTimeout(update, Math.max(0, opened + 120_000 - Date.now()))
    update()
    return () => {
      mounted = false
      clearTimeout(deadline)
      dialogs.disconnect()
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', afterFocus)
      document.removeEventListener('visibilitychange', update)
    }
  }, [opened])
  return () => (allowed ? 30_000 : false)
}
