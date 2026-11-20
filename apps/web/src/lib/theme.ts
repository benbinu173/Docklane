import { useSyncExternalStore } from 'react'

export type ColorTheme = 'system' | 'light' | 'dark'
const storageKey = 'docklane.color-theme'
const query = '(prefers-color-scheme: dark)'
const listeners = new Set<() => void>()
let preference: ColorTheme | undefined

function readPreference(): ColorTheme {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage restrictions still allow appearance changes during this visit.
  }
  return 'system'
}

function getSnapshot() {
  preference ??= readPreference()
  const resolved =
    preference === 'system' ? (window.matchMedia(query).matches ? 'dark' : 'light') : preference
  return `${preference}:${resolved}`
}

function getServerSnapshot() {
  return 'system:light'
}

export function applyTheme() {
  const resolved = getSnapshot().split(':')[1]
  const root = document.documentElement
  root.dataset.theme = resolved
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#101a26' : '#f4f6f8')
}

function notify() {
  applyTheme()
  listeners.forEach((listener) => listener())
}

function syncStorage(event: StorageEvent) {
  if (event.key === storageKey || event.key === null) {
    preference = readPreference()
    notify()
  }
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.matchMedia(query).addEventListener('change', notify)
    window.addEventListener('storage', syncStorage)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.matchMedia(query).removeEventListener('change', notify)
      window.removeEventListener('storage', syncStorage)
    }
  }
}

function setPreference(theme: ColorTheme) {
  preference = theme
  try {
    localStorage.setItem(storageKey, theme)
  } catch {
    // Keep the current selection in memory when persistence is unavailable.
  }
  notify()
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [selected, resolved] = snapshot.split(':') as [ColorTheme, 'light' | 'dark']
  return { preference: selected, resolved, setPreference }
}
