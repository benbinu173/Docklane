import { useSyncExternalStore } from 'react'

const query = '(prefers-reduced-motion: reduce)'

function subscribe(listener: () => void) {
  const media = window.matchMedia(query)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

function getSnapshot() {
  return window.matchMedia(query).matches
}

// Static markup stays still; hydration adopts the device preference.
function getServerSnapshot() {
  return true
}

export function useMotionPreference() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
